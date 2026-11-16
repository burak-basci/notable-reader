"""Choose local inference hardware; never claim CUDA after a CPU fallback."""
from __future__ import annotations

import os
import contextlib


def create_session(ort, model_path, options, device=None):
    requested = device or os.environ.get('BRAVE_READER_DEVICE', 'auto')
    if requested not in {'auto', 'cpu', 'cuda'}:
        raise ValueError('Unbekanntes Rechengerät')
    # Dynamic sentences otherwise leave large CPU activation arenas resident.
    options.enable_cpu_mem_arena = False
    if requested != 'cpu':
        try:
            # The worker's stdout is a JSONL protocol, including on fallback.
            with open(os.devnull, 'w') as quiet, contextlib.redirect_stdout(quiet), contextlib.redirect_stderr(quiet):
                ort.preload_dlls(cuda=True, cudnn=True, msvc=False, directory='')
            if 'CUDAExecutionProvider' in ort.get_available_providers():
                with open(os.devnull, 'w') as quiet, contextlib.redirect_stdout(quiet), contextlib.redirect_stderr(quiet):
                    session = ort.InferenceSession(str(model_path), sess_options=options,
                        providers=[('CUDAExecutionProvider', {
                            'device_id': 0,
                            'arena_extend_strategy': 'kSameAsRequested',
                            'gpu_mem_limit': 3 * 1024**3,
                            'cudnn_conv_algo_search': 'HEURISTIC',
                            'cudnn_conv_use_max_workspace': '0',
                            'use_tf32': '0',
                        }), 'CPUExecutionProvider'])
                if 'CUDAExecutionProvider' in session.get_providers():
                    return session
        except Exception:
            if requested == 'cuda':
                raise RuntimeError('GPU-Sprachausgabe konnte nicht gestartet werden.') from None
        if requested == 'cuda':
            raise RuntimeError('GPU-Sprachausgabe ist nicht verfügbar.')
    return ort.InferenceSession(str(model_path), sess_options=options,
                                providers=['CPUExecutionProvider'])
