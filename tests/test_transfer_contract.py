"""Regression checks for Phase 2 bounded-memory transfer paths."""
from pathlib import Path


ROOT = Path(__file__).parents[1] / "custom_components/blueprint_studio/backend"


def test_multipart_upload_uses_disk_spool_instead_of_chunk_accumulation():
    source = (ROOT / "api.py").read_text(encoding="utf-8")

    assert 'tempfile.mkstemp(prefix="blueprint-upload-"' in source
    assert "await part.read_chunk(1024 * 1024)" in source
    assert "request._client_max_size = sys.maxsize" in source
    assert "request._client_max_size = 0" not in source
    assert "chunks.append(chunk)" not in source
    assert 'file_data = b"".join(chunks)' not in source


def test_upload_finalization_is_atomic_and_cleans_partial_files():
    local_source = (ROOT / "file_manager.py").read_text(encoding="utf-8")
    sftp_source = (ROOT / "sftp_manager.py").read_text(encoding="utf-8")

    assert "os.replace(temp_path, safe_path)" in local_source
    assert "temp_path.unlink(missing_ok=True)" in local_source
    assert "sftp.rename(remote_temp, path)" in sftp_source
    assert "sftp.remove(remote_temp)" in sftp_source


def test_zip_uploads_open_disk_backed_sources_and_keep_safety_filters():
    local_source = (ROOT / "file_manager.py").read_text(encoding="utf-8")
    sftp_source = (ROOT / "sftp_manager.py").read_text(encoding="utf-8")

    assert "with zipfile.ZipFile(zip_path) as zf:" in local_source
    assert "is_macos_zip_metadata(info.filename)" in local_source
    assert "safe_zip_member_path(info.filename)" in local_source
    assert "with zipfile.ZipFile(zip_source) as zf:" in sftp_source
    assert "remote_fh.write(chunk)" in sftp_source


def test_download_queues_are_bounded_for_backpressure():
    local_source = (ROOT / "file_manager.py").read_text(encoding="utf-8")
    sftp_api_source = (ROOT / "api_sftp.py").read_text(encoding="utf-8")

    assert "queue.Queue(maxsize=8)" in local_source
    assert "queue.Queue(maxsize=8)" in sftp_api_source
