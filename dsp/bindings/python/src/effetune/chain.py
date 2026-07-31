"""Ordered serial offline and stateful streaming chains."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
import logging
from numbers import Integral
from typing import Any, Callable

import numpy as np

from ._base import Effect
from .assets import (
    AssetData,
    AssetResolver,
    resolve_asset,
    resolve_rate_divider,
    resolve_topology,
)
from .bundle import Bundle
from .errors import AssetError, EffeTuneRuntimeError, StateError, ValidationError
from .presets import LegacyImportReport, import_legacy_preset, load_preset_document
from .telemetry import TelemetryFrame, _decode_telemetry_packet
from .validation import (
    effect_metadata,
    pack_parameter_bytes,
    pack_parameters,
    validate_audio,
    validate_block_size,
    validate_chain_document,
    validate_parameters,
    validate_positive_integer,
    validate_sample_rate,
    validate_seed,
)

_LOGGER = logging.getLogger(__name__)

_STREAM_RECONFIGURATION_PARAMETERS = {
    "FIRCrossover": frozenset(
        {"bandCount", "latencyMode", "filterDelaySamples"}
    ),
    "FiveBandFIRPEQ": frozenset({"latencyMode", "filterDelaySamples"}),
    "GroupDelayEQ": frozenset({"latencyMode", "filterDelaySamples"}),
    "IRReverb": frozenset({"channelMode", "latency", "convolutionRate"}),
    "RoomEQ": frozenset({"latencyMode", "filterDelaySamples"}),
}


def _validate_stream_parameter_update(
    effect_type: str, parameters: Mapping[str, Any]
) -> None:
    restricted = _STREAM_RECONFIGURATION_PARAMETERS.get(effect_type)
    if restricted is None:
        return
    rejected = sorted(restricted.intersection(parameters))
    if rejected:
        names = ", ".join(rejected)
        raise ValidationError(
            f"{effect_type} parameter(s) {names} cannot be updated while a stream "
            "is open; create a new stream with the updated effect"
        )


def _effect_channels(channel: str, channels: int) -> int:
    if channel == "all":
        return channels
    if channel == "stereo":
        return min(channels, 2)
    if channel == "left":
        return 1
    if channel == "right":
        if channels < 2:
            raise ValidationError("the right channel is unavailable in mono audio")
        return 1
    if len(channel) == 1 and channel.isdigit():
        if int(channel) > channels:
            raise ValidationError(
                f"channel {channel} is unavailable in {channels}-channel audio"
            )
        return 1
    required = {"34": 4, "56": 6, "78": 8}.get(channel)
    if required is not None:
        if channels < required:
            raise ValidationError(
                f"channel pair {channel} is unavailable in {channels}-channel audio"
            )
        return 2
    raise ValidationError(f"unsupported effect channel: {channel}")


def _native_effect_channel(channel: str, channels: int) -> str:
    if channel == "stereo" and channels == 1:
        return "left"
    return channel


class Chain:
    """An ordered serial chain of semantic effects."""

    def __init__(
        self,
        effects: Iterable[Effect] = (),
        *,
        asset_resolver: AssetResolver | None = None,
    ) -> None:
        try:
            values = list(effects)
        except TypeError as error:
            raise ValidationError("effects must be an iterable of Effect objects") from error
        if any(not isinstance(effect, Effect) for effect in values):
            raise ValidationError("every chain entry must be an Effect")
        ids = [effect.id for effect in values if effect.id is not None]
        if len(ids) != len(set(ids)):
            duplicate = next(effect_id for effect_id in ids if ids.count(effect_id) > 1)
            raise ValidationError(f"duplicate effect id: {duplicate}")
        self.effects = tuple(values)
        self.asset_resolver = asset_resolver

    def to_dict(self) -> dict[str, Any]:
        return {"version": 1, "chain": [effect.to_dict() for effect in self.effects]}

    @classmethod
    def from_preset(
        cls, source: Any, *, asset_resolver: AssetResolver | None = None
    ) -> "Chain":
        document = load_preset_document(source)
        return cls(validate_chain_document(document), asset_resolver=asset_resolver)

    @classmethod
    def from_legacy_preset(
        cls, source: Any, *, asset_resolver: AssetResolver | None = None
    ) -> tuple["Chain", LegacyImportReport]:
        document, report = import_legacy_preset(source)
        return cls(validate_chain_document(document), asset_resolver=asset_resolver), report

    @classmethod
    def from_bundle(cls, source: str) -> "Chain":
        bundle = Bundle.load(source)
        return cls.from_preset(bundle.chain_document, asset_resolver=bundle.resolver)

    def process(
        self,
        audio: np.ndarray,
        *,
        sample_rate: float,
        seed: int = 0,
        block_size: int = 128,
        asset_resolver: AssetResolver | None = None,
        on_telemetry: Callable[[TelemetryFrame], None] | None = None,
    ) -> np.ndarray:
        """Return a processed copy using fresh state for every call."""
        source = validate_audio(audio)
        rate = validate_sample_rate(sample_rate)
        block = validate_block_size(block_size)
        initial_seed = validate_seed(seed)
        if on_telemetry is not None and not callable(on_telemetry):
            raise ValidationError("on_telemetry must be callable")
        resolver = asset_resolver if asset_resolver is not None else self.asset_resolver
        if not self.effects:
            return source.copy(order="C")
        output = np.empty_like(source, order="C")
        with self.stream(
            rate,
            channels=source.shape[0],
            block_size=block,
            seed=initial_seed,
            asset_resolver=resolver,
            on_telemetry=on_telemetry,
        ) as stream:
            for start in range(0, source.shape[1], block):
                end = min(start + block, source.shape[1])
                output[:, start:end] = stream.process(
                    np.ascontiguousarray(source[:, start:end])
                )
        return output

    def __call__(
        self, audio: np.ndarray, sample_rate: float, **options: Any
    ) -> np.ndarray:
        return self.process(audio, sample_rate=sample_rate, **options)

    def latency_samples(
        self,
        sample_rate: float,
        *,
        channels: int = 2,
        block_size: int = 128,
        asset_resolver: AssetResolver | None = None,
    ) -> int:
        """Report the aggregate chain latency without processing audio.

        The chain is prepared exactly as :meth:`stream` prepares it, the
        reported latency is read, and the native resources are released before
        returning, so offline :meth:`process` callers can phase-align their
        output without opening a stream of their own. ``channels`` selects the
        channel layout the effects are configured for and defaults to stereo;
        latency is reported for that layout.
        """
        with self.stream(
            sample_rate,
            channels=channels,
            block_size=block_size,
            asset_resolver=asset_resolver,
        ) as stream:
            return stream.latency_samples

    def stream(
        self,
        sample_rate: float,
        *,
        channels: int,
        block_size: int = 128,
        seed: int = 0,
        asset_resolver: AssetResolver | None = None,
        on_telemetry: Callable[[TelemetryFrame], None] | None = None,
    ) -> "Stream":
        return Stream(
            self,
            sample_rate=sample_rate,
            channels=channels,
            block_size=block_size,
            seed=seed,
            asset_resolver=(
                asset_resolver if asset_resolver is not None else self.asset_resolver
            ),
            on_telemetry=on_telemetry,
        )


class Stream:
    """Stateful chain processing context."""

    def __init__(
        self,
        chain: Chain,
        *,
        sample_rate: float,
        channels: int,
        block_size: int,
        seed: int,
        asset_resolver: AssetResolver | None,
        on_telemetry: Callable[[TelemetryFrame], None] | None,
    ) -> None:
        self.sample_rate = validate_sample_rate(sample_rate)
        self.channels = validate_positive_integer(channels, "channels")
        if self.channels > 8:
            raise ValidationError("channels must be at most 8")
        self.block_size = validate_block_size(block_size)
        self.seed = validate_seed(seed)
        if on_telemetry is not None and not callable(on_telemetry):
            raise ValidationError("on_telemetry must be callable")
        self._closed = False
        self._native: Any | None = None
        self._telemetry_callbacks: set[Callable[[TelemetryFrame], None]] = set()
        self._telemetry_nodes: dict[int, tuple[str, str | None, int]] = {}
        self._telemetry_pending_dropped = 0
        self._dropped_telemetry_frames = 0
        self._event_effects: dict[
            str, tuple[int, Effect, np.ndarray, np.ndarray | None, int]
        ] = {}
        self._current_parameters: dict[str, dict[str, Any]] = {}

        enabled = [(index, effect) for index, effect in enumerate(chain.effects) if effect.enabled]
        resolved_assets: dict[int, Any] = {}
        processing_channels: dict[int, int] = {}
        for index, effect in enabled:
            processing_channels[index] = _effect_channels(effect.channel, self.channels)
            metadata = effect_metadata(effect.effect_type)
            rates = metadata.get("sampleRates")
            if rates and self.sample_rate not in rates:
                supported = ", ".join(str(value) for value in rates)
                raise ValidationError(
                    f"{effect.effect_type} supports these sample rates: {supported}"
                )
            for reference in effect.assets.values():
                label = effect.id or f"{effect.effect_type} at index {index}"
                resolved_assets[index] = resolve_asset(reference, asset_resolver, label)

        if not enabled:
            if on_telemetry is not None:
                self.subscribe(on_telemetry)
            return
        try:
            from ._native import _NativeChain

            native = _NativeChain(
                self.sample_rate, self.channels, max(32, self.block_size)
            )
            initial_parameter_bytes: list[tuple[int, np.ndarray, int]] = []
            for index, effect in enabled:
                packed, layout_hash, internal_type = pack_parameters(effect)
                packed_bytes = pack_parameter_bytes(effect)
                native_index = native.add_effect(
                    internal_type,
                    packed,
                    layout_hash,
                    self.seed,
                    _native_effect_channel(effect.channel, self.channels),
                )
                self._telemetry_nodes[native_index + 1] = (
                    effect.effect_type,
                    effect.id,
                    index,
                )
                if packed_bytes is not None:
                    initial_parameter_bytes.append(
                        (native_index, packed_bytes, layout_hash)
                    )
                if effect.assets:
                    asset = resolved_assets[index]
                    effect_channels = processing_channels[index]
                    if effect.effect_type == "IRReverb":
                        topology = resolve_topology(
                            asset, effect_channels, effect.parameters["channelMode"]
                        )
                        divider = resolve_rate_divider(
                            asset.sample_rate,
                            self.sample_rate,
                            effect.parameters["convolutionRate"],
                        )
                        head_block = int(effect.parameters["latency"])
                    elif effect.effect_type == "FIRCrossover":
                        band_count = int(effect.parameters["bandCount"])
                        expected_paths = tuple(
                            (input_slot, band * 2 + input_slot, band)
                            for band in range(band_count)
                            for input_slot in range(2)
                        )
                        if asset.topology == "automatic":
                            asset = AssetData(
                                asset.samples,
                                asset.sample_rate,
                                kind=asset.kind,
                                topology="matrix",
                                paths=expected_paths,
                                input_count=2,
                            )
                        topology = resolve_topology(asset, effect_channels, "matrix")
                        divider = 1
                        head_block = int(effect.parameters["latencyMode"])
                        actual_paths = tuple(
                            (path.input_slot, path.output_slot, path.ir_channel)
                            for path in asset.paths
                        )
                        if (
                            effect_channels not in (4, 6, 8)
                            or asset.samples.shape[0] != band_count
                            or band_count * 2 > effect_channels
                            or asset.input_count != 2
                            or actual_paths != expected_paths
                        ):
                            raise AssetError(
                                f"{effect.id or effect.effect_type} requires 4, 6, "
                                "or 8 processing channels and one matrix filter "
                                "channel per band"
                            )
                    else:
                        topology = resolve_topology(asset, effect_channels, "mono")
                        divider = 1
                        head_block = int(effect.parameters["latencyMode"])
                    if divider == 1 and abs(asset.sample_rate - self.sample_rate) >= 0.5:
                        raise AssetError(
                            f"{effect.id or effect.effect_type} requires filter "
                            "coefficients at the processing sample rate"
                        )
                    paths = np.asarray(
                        [
                            (path.input_slot, path.output_slot, path.ir_channel)
                            for path in asset.paths
                        ],
                        dtype=np.uint32,
                    ).reshape((-1, 3))
                    try:
                        native.set_ir(
                            native_index,
                            asset.samples,
                            int(asset.sample_rate),
                            topology,
                            head_block,
                            divider,
                            paths,
                            int(asset.input_count or 0),
                            effect_channels,
                        )
                    except Exception as error:
                        raise AssetError(
                            f"{effect.id or effect.effect_type} convolution asset "
                            "could not be staged within the 32 MiB native asset limit"
                        ) from error
                if effect.id is not None:
                    self._event_effects[effect.id] = (
                        native_index,
                        effect,
                        packed.copy(),
                        packed_bytes.copy() if packed_bytes is not None else None,
                        layout_hash,
                    )
                    self._current_parameters[effect.id] = dict(effect.parameters)
            native.finish()
            for native_index, packed_bytes, layout_hash in initial_parameter_bytes:
                native.set_effect_parameter_bytes(
                    native_index, packed_bytes, layout_hash
                )
            self._native = native
            if on_telemetry is not None:
                self.subscribe(on_telemetry)
        except (AssetError, ValidationError):
            raise
        except Exception as error:
            raise EffeTuneRuntimeError("the native DSP chain could not be prepared") from error

    @property
    def closed(self) -> bool:
        return self._closed

    @property
    def latency_samples(self) -> int:
        """Report the aggregate latency of the configured serial chain."""
        if self._closed:
            raise StateError("cannot inspect a closed stream")
        if self._native is None:
            return 0
        try:
            return int(self._native.latency_samples())
        except Exception as error:
            raise EffeTuneRuntimeError("native DSP latency could not be read") from error

    @property
    def dropped_telemetry_frames(self) -> int:
        """Return the number of telemetry frames lost during this stream."""
        if self._closed:
            raise StateError("cannot inspect a closed stream")
        return self._dropped_telemetry_frames

    def subscribe(
        self, callback: Callable[[TelemetryFrame], None]
    ) -> Callable[[], bool]:
        """Subscribe to decoded analyzer observations."""
        if self._closed:
            raise StateError("cannot subscribe to a closed stream")
        if not callable(callback):
            raise ValidationError("telemetry callback must be callable")
        was_empty = not self._telemetry_callbacks
        self._telemetry_callbacks.add(callback)
        if was_empty and self._native is not None:
            try:
                self._native.set_telemetry_enabled(True)
            except Exception as error:
                self._telemetry_callbacks.remove(callback)
                raise EffeTuneRuntimeError(
                    "native DSP telemetry could not be enabled"
                ) from error
        return lambda: self.unsubscribe(callback)

    def unsubscribe(self, callback: Callable[[TelemetryFrame], None]) -> bool:
        """Remove a telemetry callback."""
        if self._closed:
            raise StateError("cannot unsubscribe from a closed stream")
        if callback not in self._telemetry_callbacks:
            return False
        self._telemetry_callbacks.remove(callback)
        if not self._telemetry_callbacks and self._native is not None:
            try:
                self._native.set_telemetry_enabled(False)
            except Exception as error:
                raise EffeTuneRuntimeError(
                    "native DSP telemetry could not be disabled"
                ) from error
        return True

    def process(
        self, audio: np.ndarray, *, events: Iterable[Mapping[str, Any]] = ()
    ) -> np.ndarray:
        if self._closed:
            raise StateError("cannot process a closed stream")
        source = validate_audio(audio, channels=self.channels)
        prepared_events = self._prepare_events(events, source.shape[1])
        output = source.copy(order="C")
        if self._native is None:
            if prepared_events:
                raise ValidationError("parameter events require an enabled effect with an id")
            return output
        try:
            cursor = 0
            for (
                frame,
                effect_id,
                native_index,
                packed,
                packed_bytes,
                layout_hash,
                parameters,
            ) in prepared_events:
                self._process_range(output, cursor, frame)
                self._native.set_effect_parameters(
                    native_index, packed, layout_hash
                )
                if packed_bytes is not None:
                    self._native.set_effect_parameter_bytes(
                        native_index, packed_bytes, layout_hash
                    )
                self._current_parameters[effect_id] = parameters
                cursor = frame
            self._process_range(output, cursor, output.shape[1])
        except Exception as error:
            raise EffeTuneRuntimeError("native DSP processing failed") from error
        return output

    def _prepare_events(
        self, events: Iterable[Mapping[str, Any]], frames: int
    ) -> list[
        tuple[int, str, int, np.ndarray, np.ndarray | None, int, dict[str, Any]]
    ]:
        try:
            supplied = list(events)
        except TypeError as error:
            raise ValidationError("events must be an iterable of parameter event objects") from error
        prepared: list[
            tuple[int, str, int, np.ndarray, np.ndarray | None, int, dict[str, Any]]
        ] = []
        working_parameters = {
            effect_id: dict(parameters)
            for effect_id, parameters in self._current_parameters.items()
        }
        for index, event in enumerate(supplied):
            if not isinstance(event, Mapping) or set(event) != {
                "frame",
                "effectId",
                "parameters",
            }:
                raise ValidationError(
                    f"events[{index}] requires only frame, effectId, and parameters"
                )
            frame = event["frame"]
            if (
                isinstance(frame, bool)
                or not isinstance(frame, Integral)
                or not 0 <= int(frame) < frames
            ):
                raise ValidationError(
                    f"events[{index}].frame must be an integer from 0 to {frames - 1}"
                )
            effect_id = event["effectId"]
            if not isinstance(effect_id, str) or effect_id not in self._event_effects:
                raise ValidationError(
                    f"events[{index}].effectId must identify an enabled effect"
                )
            native_index, effect, _, _, _ = self._event_effects[effect_id]
            parameters = event["parameters"]
            if not isinstance(parameters, Mapping):
                raise ValidationError(
                    f"events[{index}].parameters must be an object"
                )
            _validate_stream_parameter_update(effect.effect_type, parameters)
            merged = dict(working_parameters[effect_id])
            merged.update(parameters)
            validated = validate_parameters(effect.effect_type, merged)
            working_parameters[effect_id] = validated
            event_effect = Effect(
                effect.effect_type,
                parameters=validated,
                assets=effect.assets,
            )
            packed, layout_hash, _ = pack_parameters(event_effect)
            packed_bytes = pack_parameter_bytes(event_effect)
            prepared.append(
                (
                    int(frame),
                    effect_id,
                    native_index,
                    packed,
                    packed_bytes,
                    layout_hash,
                    validated,
                )
            )
        if any(
            prepared[index][0] > prepared[index + 1][0]
            for index in range(len(prepared) - 1)
        ):
            raise ValidationError("parameter events must be ordered by frame")
        return prepared

    def _process_range(self, output: np.ndarray, start: int, end: int) -> None:
        while start < end:
            segment_end = min(start + self.block_size, end)
            segment = np.ascontiguousarray(output[:, start:segment_end])
            self._native.process_in_place(segment)
            output[:, start:segment_end] = segment
            if self._telemetry_callbacks:
                self._drain_telemetry()
            start = segment_end

    def _drain_telemetry(self) -> None:
        packet = self._native.read_telemetry()
        dropped = int(self._native.last_telemetry_dropped())
        self._dropped_telemetry_frames += dropped
        frames, self._telemetry_pending_dropped = _decode_telemetry_packet(
            packet,
            self._telemetry_nodes,
            self._telemetry_pending_dropped + dropped,
        )
        for frame in frames:
            for callback in tuple(self._telemetry_callbacks):
                try:
                    callback(frame)
                except Exception as error:
                    _LOGGER.warning(
                        "EffeTune telemetry callback failed: %s",
                        error,
                        exc_info=True,
                    )

    def reset(self) -> None:
        if self._closed:
            raise StateError("cannot reset a closed stream")
        if self._native is None:
            return
        try:
            self._native.reset()
            for effect_id, (
                native_index,
                effect,
                initial_packed,
                initial_packed_bytes,
                layout_hash,
            ) in self._event_effects.items():
                self._native.set_effect_parameters(
                    native_index, initial_packed, layout_hash
                )
                if initial_packed_bytes is not None:
                    self._native.set_effect_parameter_bytes(
                        native_index, initial_packed_bytes, layout_hash
                    )
                self._current_parameters[effect_id] = dict(effect.parameters)
        except Exception as error:
            raise EffeTuneRuntimeError("native DSP reset failed") from error

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        self._telemetry_callbacks.clear()
        if self._native is not None:
            try:
                self._native.close()
            finally:
                self._native = None

    def __enter__(self) -> "Stream":
        if self._closed:
            raise StateError("cannot enter a closed stream")
        return self

    def __exit__(self, *_: Any) -> None:
        self.close()


__all__ = ["Chain", "Stream"]
