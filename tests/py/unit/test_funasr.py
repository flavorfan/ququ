import funasr_server


class _FakeVADModel:
    def __init__(self):
        self.calls = []

    def generate(self, **kwargs):
        self.calls.append(kwargs)
        return [{"segments": []}]


class _FakeASRModel:
    def __init__(self):
        self.calls = []

    def generate(self, **kwargs):
        self.calls.append(kwargs)
        return [{"text": "你好世界"}]


class _FakePuncModel:
    def __init__(self):
        self.calls = []

    def generate(self, **kwargs):
        self.calls.append(kwargs)
        return [{"text": "你好，世界。"}]


def test_transcribe_audio_returns_error_for_missing_file():
    server = funasr_server.FunASRServer()
    server.initialized = True

    result = server.transcribe_audio("Z:/this/path/does/not/exist.wav")

    assert result["success"] is False
    assert "Audio file not found" in result["error"]


def test_transcribe_audio_uses_default_options_and_updates_counters(tmp_path):
    audio_file = tmp_path / "sample.wav"
    audio_file.write_bytes(b"RIFF....WAVE")

    server = funasr_server.FunASRServer()
    server.initialized = True
    server.asr_model = _FakeASRModel()
    server.vad_model = _FakeVADModel()
    server.punc_model = _FakePuncModel()

    result = server.transcribe_audio(str(audio_file))

    assert result["success"] is True
    assert result["raw_text"] == "你好世界"
    assert result["text"] == "你好，世界。"
    assert server.transcription_count == 1

    assert len(server.vad_model.calls) == 1
    assert server.vad_model.calls[0]["batch_size_s"] == 60
    assert server.vad_model.calls[0]["input"] == str(audio_file)

    assert len(server.asr_model.calls) == 1
    assert server.asr_model.calls[0]["batch_size_s"] == 60
    assert server.asr_model.calls[0]["hotword"] == ""
    assert server.asr_model.calls[0]["input"] == str(audio_file)


def test_transcribe_audio_returns_initialize_error_when_init_fails(monkeypatch):
    server = funasr_server.FunASRServer()

    monkeypatch.setattr(
        server,
        "initialize",
        lambda: {"success": False, "error": "init failed", "type": "init_error"},
    )

    result = server.transcribe_audio("any.wav")

    assert result == {"success": False, "error": "init failed", "type": "init_error"}