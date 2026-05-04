#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
FunASR Model Server
Keeps models in memory, communicates via stdin/stdout
"""

import sys
import json
import os
import logging
import traceback
import signal
import contextlib
import io
import argparse
import glob
from pathlib import Path

# Configure logging
import tempfile
import os


# Get log file path
def get_log_path():
    # Try to get user data directory from environment variable
    if "ELECTRON_USER_DATA" in os.environ:
        log_dir = os.path.join(os.environ["ELECTRON_USER_DATA"], "logs")
    else:
        # Fall back to temp directory
        log_dir = os.path.join(tempfile.gettempdir(), "ququ_logs")

    # Ensure log directory exists
    os.makedirs(log_dir, exist_ok=True)
    return os.path.join(log_dir, "funasr_server.log")


log_file_path = get_log_path()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    handlers=[
        logging.FileHandler(log_file_path, encoding="utf-8"),
        logging.StreamHandler(),  # Also output to console
    ],
)
logger = logging.getLogger(__name__)

# Record log file location
logger.info(f"FunASR server log file: {log_file_path}")


@contextlib.contextmanager
def suppress_stdout():
    """Context manager: temporarily redirect stdout to devnull to prevent FunASR library's non-JSON output from interfering with IPC communication"""
    old_stdout = sys.stdout
    devnull = open(os.devnull, "w")
    try:
        sys.stdout = devnull
        yield
    finally:
        sys.stdout = old_stdout
        devnull.close()


class FunASRServer:
    def __init__(self, damo_root=None):
        self.asr_model = None
        self.vad_model = None
        self.punc_model = None
        self.initialized = False
        self.running = True
        self.transcription_count = 0
        self.total_audio_duration = 0.0

        # Externally provided damo root directory (e.g. /Volumes/APFS/AI/models/damo)
        self.damo_root = damo_root or os.environ.get("DAMO_ROOT")

        signal.signal(signal.SIGTERM, self._signal_handler)
        signal.signal(signal.SIGINT, self._signal_handler)
        self._setup_runtime_environment()

    def _setup_runtime_environment(self):
        """Setup runtime environment variables for performance optimization"""
        try:
            import os

            # Set thread count optimization
            os.environ["OMP_NUM_THREADS"] = "4"
            logger.info("Runtime environment variables configured")
        except Exception as e:
            logger.warning(f"Environment setup failed: {str(e)}")

    def _signal_handler(self, signum, frame):
        """Handle exit signals"""
        logger.info(f"Received signal {signum}, preparing to exit...")
        self.running = False

    def _load_asr_model(self):
        """Load ASR model"""
        try:
            logger.info("Starting to load ASR model...")
            with suppress_stdout():
                from funasr import AutoModel

                self.asr_model = AutoModel(
                    model="damo/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
                    model_revision="v2.0.4",
                    disable_update=True,
                    device="cpu",
                )
            logger.info("ASR model loaded successfully")
            return True
        except Exception as e:
            logger.error(f"Failed to load ASR model: {str(e)}")
            return False

    def _load_vad_model(self):
        """Load VAD model"""
        try:
            logger.info("Starting to load VAD model...")
            with suppress_stdout():
                from funasr import AutoModel

                self.vad_model = AutoModel(
                    model="damo/speech_fsmn_vad_zh-cn-16k-common-pytorch",
                    model_revision="v2.0.4",
                    disable_update=True,
                    device="cpu",
                )
            logger.info("VAD model loaded successfully")
            return True
        except Exception as e:
            logger.error(f"Failed to load VAD model: {str(e)}")
            return False

    def _load_punc_model(self):
        """Load punctuation recovery model"""
        try:
            import time

            start_time = time.time()
            logger.info("Starting to load punctuation recovery model...")

            # Record import time
            import_start = time.time()
            with suppress_stdout():
                from funasr import AutoModel
            import_time = time.time() - import_start
            logger.info(f"FunASR import took: {import_time:.2f}s")

            # Record model creation time
            model_start = time.time()
            with suppress_stdout():
                self.punc_model = AutoModel(
                    model="damo/punc_ct-transformer_zh-cn-common-vocab272727-pytorch",
                    model_revision="v2.0.4",
                    disable_update=True,
                    device="cpu",
                )
            model_time = time.time() - model_start
            total_time = time.time() - start_time

            logger.info(
                f"Punctuation recovery model loaded - Model creation took: {model_time:.2f}s, Total time: {total_time:.2f}s"
            )
            return True
        except Exception as e:
            logger.error(f"Failed to load punctuation recovery model: {str(e)}")
            return False

    def initialize(self):
        """Initialize FunASR models in parallel"""
        if self.initialized:
            return {"success": True, "message": "Models already initialized"}

        try:
            import threading
            import time

            logger.info("Initializing FunASR models in parallel...")
            start_time = time.time()

            # Create storage for loading results
            results = {}

            def load_model_thread(model_name, load_func):
                """Model loading thread wrapper function"""
                thread_start = time.time()
                results[model_name] = load_func()
                thread_time = time.time() - thread_start
                logger.info(f"{model_name} model loading thread took: {thread_time:.2f}s")

            # Create and start three parallel threads
            threads = [
                threading.Thread(
                    target=load_model_thread, args=("asr", self._load_asr_model)
                ),
                threading.Thread(
                    target=load_model_thread, args=("vad", self._load_vad_model)
                ),
                threading.Thread(
                    target=load_model_thread, args=("punc", self._load_punc_model)
                ),
            ]

            # Start all threads
            for thread in threads:
                thread.start()

            # Wait for all threads to complete with timeout
            for thread in threads:
                thread.join(timeout=300)  # 5 minute timeout
                if thread.is_alive():
                    logger.error("Model loading thread timeout")
                    return {
                        "success": False,
                        "error": "Model loading timeout",
                        "type": "timeout_error",
                    }

            # Check loading results
            failed_models = [name for name, success in results.items() if not success]

            if failed_models:
                error_msg = f"The following models failed to load: {', '.join(failed_models)}"
                logger.error(error_msg)
                return {"success": False, "error": error_msg, "type": "init_error"}

            total_time = time.time() - start_time
            self.initialized = True
            logger.info(
                f"All FunASR models initialized in parallel, total time: {total_time:.2f}s"
            )
            return {
                "success": True,
                "message": f"FunASR models initialized in parallel, took: {total_time:.2f}s",
            }

        except ImportError as e:
            error_msg = "FunASR is not installed, please install it first: pip install funasr"
            logger.error(error_msg)
            return {"success": False, "error": error_msg, "type": "import_error"}

        except Exception as e:
            error_msg = f"FunASR model initialization failed: {str(e)}"
            logger.error(error_msg)
            logger.error(traceback.format_exc())
            return {"success": False, "error": error_msg, "type": "init_error"}

    def transcribe_audio(self, audio_path, options=None):
        """Transcribe audio file"""
        if not self.initialized:
            init_result = self.initialize()
            if not init_result["success"]:
                return init_result

        try:
            # Check if audio file exists
            if not os.path.exists(audio_path):
                return {"success": False, "error": f"Audio file not found: {audio_path}"}

            logger.info(f"Starting to transcribe audio file: {audio_path}")

            # Set default options
            default_options = {
                "batch_size_s": 60,
                "hotword": "",
                "use_vad": True,
                "use_punc": True,  # Use FunASR's built-in punctuation recovery
                "language": "zh",
            }

            if options:
                default_options.update(options)

            # Execute speech recognition
            if default_options["use_vad"]:
                vad_result = self.vad_model.generate(
                    input=audio_path, batch_size_s=default_options["batch_size_s"]
                )
                logger.info("VAD processing completed")

            # Execute ASR recognition
            asr_result = self.asr_model.generate(
                input=audio_path,
                batch_size_s=default_options["batch_size_s"],
                hotword=default_options["hotword"],
                cache={},
            )

            # Extract recognition text
            if isinstance(asr_result, list) and len(asr_result) > 0:
                if isinstance(asr_result[0], dict) and "text" in asr_result[0]:
                    raw_text = asr_result[0]["text"]
                else:
                    raw_text = str(asr_result[0])
            else:
                raw_text = str(asr_result)

            logger.info(f"ASR recognition completed, raw text: {raw_text[:100]}...")

            # Use FunASR for punctuation recovery
            final_text = raw_text
            if default_options["use_punc"] and self.punc_model and raw_text.strip():
                try:
                    punc_result = self.punc_model.generate(input=raw_text)
                    if isinstance(punc_result, list) and len(punc_result) > 0:
                        if (
                            isinstance(punc_result[0], dict)
                            and "text" in punc_result[0]
                        ):
                            final_text = punc_result[0]["text"]
                        else:
                            final_text = str(punc_result[0])
                    logger.info("FunASR punctuation recovery completed")
                except Exception as e:
                    logger.warning(f"FunASR punctuation recovery failed, using original text: {str(e)}")

            duration = self._get_audio_duration(audio_path)
            self.transcription_count += 1

            result = {
                "success": True,
                "text": final_text,
                "raw_text": raw_text,
                "confidence": (
                    getattr(asr_result[0], "confidence", 0.0)
                    if isinstance(asr_result, list)
                    else 0.0
                ),
                "duration": duration,
                "language": "zh-CN",
                "model_type": "pytorch",  # Indicates pytorch version is used
            }

            # Production environment: perform memory cleanup after every 10 transcriptions
            if self.transcription_count % 10 == 0:
                self._cleanup_memory()
                logger.info(f"Completed {self.transcription_count} transcriptions, performing memory cleanup")

            logger.info(f"Transcription completed, final text: {final_text[:100]}...")
            return result

        except Exception as e:
            error_msg = f"Audio transcription failed: {str(e)}"
            logger.error(error_msg)
            logger.error(traceback.format_exc())
            return {"success": False, "error": error_msg, "type": "transcription_error"}

    def _get_audio_duration(self, audio_path):
        """Get audio duration"""
        try:
            import librosa

            duration = librosa.get_duration(filename=audio_path)
            self.total_audio_duration += duration  # Accumulate total audio duration
            return duration
        except:
            return 0.0

    def _cleanup_memory(self):
        """Production environment memory cleanup"""
        try:
            import gc

            gc.collect()
            logger.info("Memory cleanup completed")
        except Exception as e:
            logger.warning(f"Memory cleanup failed: {str(e)}")

    def get_performance_stats(self):
        """Get performance statistics"""
        return {
            "transcription_count": self.transcription_count,
            "total_audio_duration": round(self.total_audio_duration, 2),
            "average_duration": round(
                self.total_audio_duration / max(1, self.transcription_count), 2
            ),
            "initialized": self.initialized,
            "models_loaded": {
                "asr": self.asr_model is not None,
                "vad": self.vad_model is not None,
                "punc": self.punc_model is not None,
            },
        }

    def check_status(self):
        """Check FunASR status"""
        try:
            import funasr

            return {
                "success": True,
                "installed": True,
                "initialized": self.initialized,
                "version": getattr(funasr, "__version__", "unknown"),
                "models": {
                    "asr": self.asr_model is not None,
                    "vad": self.vad_model is not None,
                    "punc": self.punc_model is not None,  # FunASR punctuation recovery model status
                },
            }
        except ImportError:
            return {
                "success": False,
                "installed": False,
                "initialized": False,
                "error": "FunASR is not installed",
            }

    def run(self):
        """Run server main loop"""
        logger.info("FunASR server started")

        # Parse damo root directory
        def _default_damo_root():
            # Allow specifying root via MODELSCOPE_CACHE; common is ~/.cache/modelscope/hub/damo
            root = os.environ.get("MODELSCOPE_CACHE")
            if root:
                # Support two layouts: <cache>/damo or <cache>/hub/damo
                if os.path.isdir(os.path.join(root, "damo")):
                    return os.path.join(root, "damo")
                if os.path.isdir(os.path.join(root, "hub", "damo")):
                    return os.path.join(root, "hub", "damo")
                # Like Node, if customizing to /Volumes/APFS/AI/models/damo, pass --damo-root directly
            # Default to modelscope/hub/damo in user home directory
            home_dir = os.path.expanduser("~")
            return os.path.join(home_dir, ".cache", "modelscope", "hub", "models", "damo")

        cache_path = self.damo_root if self.damo_root else _default_damo_root()
        logger.info(f"Model root directory (damo root): {cache_path}")

        repos = [
            "speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
            "speech_fsmn_vad_zh-cn-16k-common-pytorch",
            "punc_ct-transformer_zh-cn-common-vocab272727-pytorch",
        ]

        def _repo_ready(repo_dir):
            # Directory exists and contains any common weight/config files
            if not os.path.isdir(repo_dir):
                return False
            patterns = [
                "model.pt", "pytorch_model.bin", "*.onnx",
                "config.json", "configuration.json", "model.yaml", "vocab*"
            ]
            for pat in patterns:
                if glob.glob(os.path.join(repo_dir, pat)):
                    return True
            return False

        missing = []
        for r in repos:
            rd = os.path.join(cache_path, r)
            if not _repo_ready(rd):
                missing.append(r)

        if not missing:
            logger.info("Model files exist, starting initialization")
            init_result = self.initialize()
        else:
            logger.info(f"Model files missing or incomplete: {', '.join(missing)}, skipping initialization")
            init_result = {
                "success": False,
                "error": "Model files not downloaded, please download models first",
                "type": "models_not_downloaded"
            }
        print(json.dumps(init_result, ensure_ascii=False))
        sys.stdout.flush()

        while self.running:
            try:
                # Read command
                line = sys.stdin.readline()
                if not line:
                    break

                line = line.strip()
                if not line:
                    continue

                try:
                    command = json.loads(line)
                except json.JSONDecodeError:
                    result = {"success": False, "error": "Invalid JSON command"}
                    print(json.dumps(result, ensure_ascii=False))
                    sys.stdout.flush()
                    continue

                # Process command
                if command.get("action") == "transcribe":
                    audio_path = command.get("audio_path")
                    options = command.get("options", {})
                    result = self.transcribe_audio(audio_path, options)
                elif command.get("action") == "status":
                    result = self.check_status()
                elif command.get("action") == "stats":
                    result = {"success": True, "stats": self.get_performance_stats()}
                elif command.get("action") == "cleanup":
                    self._cleanup_memory()
                    result = {"success": True, "message": "Memory cleanup completed"}
                elif command.get("action") == "exit":
                    result = {"success": True, "message": "Server exiting"}
                    print(json.dumps(result, ensure_ascii=False))
                    sys.stdout.flush()
                    break
                else:
                    result = {
                        "success": False,
                        "error": f"Unknown command: {command.get('action')}",
                    }

                # Output result
                print(json.dumps(result, ensure_ascii=False))
                sys.stdout.flush()

            except KeyboardInterrupt:
                break
            except Exception as e:
                error_result = {
                    "success": False,
                    "error": str(e),
                    "traceback": traceback.format_exc(),
                }
                print(json.dumps(error_result, ensure_ascii=False))
                sys.stdout.flush()

        logger.info("FunASR server exiting")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--damo-root", type=str, default=None,
                        help="damo model root directory, e.g. /Volumes/APFS/AI/models/damo")
    args = parser.parse_args()

    server = FunASRServer(damo_root=args.damo_root)
    server.run()
