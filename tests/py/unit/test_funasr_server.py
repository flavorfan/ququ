import os

import funasr_server


def test_get_log_path_uses_electron_user_data(monkeypatch, tmp_path):
    monkeypatch.setenv('ELECTRON_USER_DATA', str(tmp_path))

    log_path = funasr_server.get_log_path()

    assert log_path == os.path.join(str(tmp_path), 'logs', 'funasr_server.log')


def test_check_status_before_initialize_reports_not_ready():
    server = funasr_server.FunASRServer()

    status = server.check_status()

    assert status['success'] is True
    assert status['installed'] is True
    assert status['initialized'] is False
    assert status['models'] == {'asr': False, 'vad': False, 'punc': False}


def test_initialize_short_circuits_when_already_initialized():
    server = funasr_server.FunASRServer()
    server.initialized = True

    result = server.initialize()

    assert result == {'success': True, 'message': 'Models already initialized'}


def test_get_performance_stats_exposes_counters():
    server = funasr_server.FunASRServer()
    server.transcription_count = 3
    server.total_audio_duration = 12.5

    stats = server.get_performance_stats()

    assert stats['transcription_count'] == 3
    assert stats['total_audio_duration'] == 12.5