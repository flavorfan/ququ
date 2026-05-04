import json
import os
import pathlib
import subprocess
import sys


ROOT = pathlib.Path(__file__).resolve().parents[3]
SERVER_SCRIPT = ROOT / 'funasr_server.py'


def start_server(tmp_path):
    env = os.environ.copy()
    env['DAMO_ROOT'] = str(tmp_path / 'missing-damo-root')
    env['ELECTRON_USER_DATA'] = str(tmp_path / 'user-data')

    server_process = subprocess.Popen(
        [sys.executable, os.fspath(SERVER_SCRIPT)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        cwd=os.fspath(ROOT),
        env=env,
    )

    init_line = server_process.stdout.readline().strip()
    if not init_line:
        stderr_output = server_process.stderr.read()
        raise AssertionError(f'FunASR server did not emit init JSON. stderr: {stderr_output}')

    return server_process, json.loads(init_line)


def send_command(server_process, payload):
    server_process.stdin.write(payload + '\n')
    server_process.stdin.flush()

    while True:
        line = server_process.stdout.readline()
        if not line:
            stderr_output = server_process.stderr.read()
            raise AssertionError(f'FunASR server closed before sending JSON. stderr: {stderr_output}')

        stripped = line.strip()
        if not stripped:
            continue

        try:
            return json.loads(stripped)
        except json.JSONDecodeError:
            continue


def test_server_reports_missing_models_and_handles_protocol_commands(tmp_path):
    server_process, init_result = start_server(tmp_path)

    try:
                assert init_result['success'] is False
                assert init_result['type'] == 'models_not_downloaded'

                invalid_json_result = send_command(server_process, '{invalid json')
                assert invalid_json_result['success'] is False
                assert invalid_json_result['error'] == 'Invalid JSON command'

                unknown_result = send_command(server_process, json.dumps({'action': 'unknown'}))
                assert unknown_result['success'] is False
                assert 'Unknown command' in unknown_result['error']

                status_result = send_command(server_process, json.dumps({'action': 'status'}))
                assert status_result['success'] is True
                assert status_result['initialized'] is False
                assert status_result['models'] == {'asr': False, 'vad': False, 'punc': False}

                stats_result = send_command(server_process, json.dumps({'action': 'stats'}))
                assert stats_result['success'] is True
                assert stats_result['stats']['transcription_count'] == 0

                exit_result = send_command(server_process, json.dumps({'action': 'exit'}))
                assert exit_result['success'] is True
                assert exit_result['message'] == 'Server exiting'
    finally:
                server_process.kill()
                server_process.wait(timeout=5)