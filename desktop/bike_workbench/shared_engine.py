"""Execute the same checked-in JavaScript used by the browser; no Node/server."""
import json
import os
from pathlib import Path

ENGINE_PATH = Path(__file__).resolve().parents[2] / 'analysis-engine.mjs'
_engine = _module = _app = None


def call(operation, *args):
    global _engine, _module, _app
    from PySide6.QtWidgets import QApplication
    from PySide6.QtQml import QJSEngine
    if _engine is None:
        # GUI startup creates its own QApplication before analysis. CLI/tests use
        # an offscreen instance so there is no display or server requirement.
        _app = QApplication.instance()
        if _app is None:
            os.environ.setdefault('QT_QPA_PLATFORM', 'offscreen')
            _app = QApplication([])
        _engine = QJSEngine()
        _module = _engine.importModule(str(ENGINE_PATH))
        if _module.isError():
            message = _module.toString() + " at line " + _module.property("lineNumber").toString()
            _engine = _module = None
            raise ValueError("Shared engine could not load: " + message)
    request = json.dumps({'operation': operation, 'args': args}, allow_nan=False)
    result = _module.property('dispatch').call([request])
    if result.isError():
        raise ValueError(result.toString())
    return json.loads(result.toString())
