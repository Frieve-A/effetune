from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path


_AUDITOR_PATH = Path(__file__).resolve().parents[1] / "tools" / "audit_native_exports.py"
_SPEC = importlib.util.spec_from_file_location("effetune_native_export_auditor", _AUDITOR_PATH)
assert _SPEC is not None and _SPEC.loader is not None
_AUDITOR = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(_AUDITOR)


class NativeExportTests(unittest.TestCase):
    def test_windows_allowlist_keeps_the_exception_abi_surface(self) -> None:
        allowed = (
            "PyInit__native",
            "??0builtin_exception@nanobind@@QEAA@AEBV01@@Z",
            "?what@python_error@nanobind@@UEBAPEBDXZ",
            "??0builtin_exception@abi1@nanobind@@QEAA@AEBV012@@Z",
            "?what@python_error@abi1@nanobind@@UEBAPEBDXZ",
        )
        rejected = (
            "et_initialize",
            "PyInit_unrelated",
            "?new_symbol@nanobind@@QEAAHXZ",
            "?what@new_exception@abi1@nanobind@@UEBAPEBDXZ",
            "?what@python_error@abi2@nanobind@@UEBAPEBDXZ",
            "?what@python_error@arbitrary@nanobind@@UEBAPEBDXZ",
            "?what@python_error@abi1@unrelated@@UEBAPEBDXZ",
        )
        for symbols, expected in ((allowed, True), (rejected, False)):
            for symbol in symbols:
                with self.subTest(symbol=symbol):
                    self.assertEqual(_AUDITOR._allowed_windows_export(symbol), expected)


if __name__ == "__main__":
    unittest.main()
