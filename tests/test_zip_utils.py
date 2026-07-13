import importlib.util
import pathlib

ZIP_UTILS_PATH = (
    pathlib.Path(__file__).resolve().parents[1]
    / "custom_components"
    / "blueprint_studio"
    / "backend"
    / "zip_utils.py"
)

spec = importlib.util.spec_from_file_location("zip_utils", ZIP_UTILS_PATH)
zip_utils = importlib.util.module_from_spec(spec)
spec.loader.exec_module(zip_utils)

is_macos_zip_metadata = zip_utils.is_macos_zip_metadata
safe_zip_member_path = zip_utils.safe_zip_member_path


def test_safe_zip_member_path_accepts_normal_relative_paths():
    assert safe_zip_member_path("folder/file.yaml") == "folder/file.yaml"
    assert safe_zip_member_path("./folder//file.yaml") == "folder/file.yaml"
    assert safe_zip_member_path("folder\\file.yaml") == "folder/file.yaml"


def test_safe_zip_member_path_rejects_traversal_and_absolute_paths():
    assert safe_zip_member_path("../secret.yaml") is None
    assert safe_zip_member_path("folder/../../secret.yaml") is None
    assert safe_zip_member_path("/etc/passwd") is None
    assert safe_zip_member_path("C:/Windows/win.ini") is None
    assert safe_zip_member_path("folder/\x00bad") is None


def test_is_macos_zip_metadata_detects_common_entries():
    assert is_macos_zip_metadata("__MACOSX/._file")
    assert is_macos_zip_metadata("folder/.DS_Store")
    assert is_macos_zip_metadata(".DS_Store")
    assert not is_macos_zip_metadata("folder/file.yaml")
