"""Semantic effect base class."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from .validation import validate_effect_options


class Effect:
    """One validated semantic effect, independent of the packed native ABI."""

    effect_type: str

    def __init__(
        self,
        effect_type: str,
        *,
        parameters: Mapping[str, Any] | None = None,
        id: str | None = None,
        enabled: bool = True,
        channel: str = "all",
        assets: Mapping[str, str] | None = None,
    ) -> None:
        (
            self.parameters,
            self.id,
            self.enabled,
            self.channel,
            self.assets,
        ) = validate_effect_options(
            effect_type,
            parameters=parameters,
            id=id,
            enabled=enabled,
            channel=channel,
            assets=assets,
        )
        self.effect_type = effect_type

    @property
    def type(self) -> str:
        """Return the canonical semantic type name."""
        return self.effect_type

    def to_dict(self) -> dict[str, Any]:
        """Return the canonical serializable effect document."""
        result: dict[str, Any] = {
            "type": self.effect_type,
            "enabled": self.enabled,
            "channel": self.channel,
            "parameters": {
                name: list(value) if isinstance(value, tuple) else value
                for name, value in self.parameters.items()
            },
        }
        if self.id is not None:
            result["id"] = self.id
        if self.assets:
            result["assets"] = dict(self.assets)
        return result

    def process(self, audio: Any, *, sample_rate: float, **options: Any) -> Any:
        """Process a fresh offline copy through this effect."""
        from .chain import Chain

        return Chain([self]).process(audio, sample_rate=sample_rate, **options)

    def __call__(self, audio: Any, sample_rate: float, **options: Any) -> Any:
        """Convenience alias for :meth:`process`."""
        return self.process(audio, sample_rate=sample_rate, **options)

    def __repr__(self) -> str:
        return f"{self.effect_type}({self.parameters!r})"


__all__ = ["Effect"]
