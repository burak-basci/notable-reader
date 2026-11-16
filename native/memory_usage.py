"""Return free native-library heap pages to Linux without unloading models."""
import ctypes

try:
    _trim = ctypes.CDLL(None).malloc_trim
    _trim.argtypes = [ctypes.c_size_t]
    _trim.restype = ctypes.c_int
except (AttributeError, OSError):
    _trim = None


def release_unused_memory():
    if _trim is not None:
        _trim(0)
