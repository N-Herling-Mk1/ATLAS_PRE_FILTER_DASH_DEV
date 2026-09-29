"""mk47 container plumbing: the path remap and the image commit stamp.
Paths only -- no data is read or made here."""
import importlib


def test_path_map_rewrites_windows_prefix(monkeypatch):
    monkeypatch.setenv("PFD_PATH_MAP", r"C:\Users\natha\OneDrive\Desktop\0_mL_ATLAS=>/data")
    from engine import loader
    assert loader.remap(r"C:\Users\natha\OneDrive\Desktop\0_mL_ATLAS\a\mS16_barrel.csv") == "/data/a/mS16_barrel.csv"
    # case- and slash-insensitive, as Windows is
    assert loader.remap("c:/users/NATHA/OneDrive/Desktop/0_mL_ATLAS/x.csv") == "/data/x.csv"
    # a sibling folder with the same prefix string is NOT inside the mount
    assert loader.remap(r"C:\Users\natha\OneDrive\Desktop\0_mL_ATLAS_old\x.csv").startswith("C:")
    assert loader.remap("/elsewhere/x.csv") == "/elsewhere/x.csv"


def test_path_map_longest_prefix_wins(monkeypatch):
    monkeypatch.setenv("PFD_PATH_MAP", r"C:\d=>/a;C:\d\sub=>/b")
    from engine import loader
    assert loader.remap(r"C:\d\sub\f.csv") == "/b/f.csv"
    assert loader.remap(r"C:\d\f.csv") == "/a/f.csv"


def test_no_map_is_identity(monkeypatch):
    monkeypatch.delenv("PFD_PATH_MAP", raising=False)
    from engine import loader
    assert loader.remap(r"C:\x\y.csv") == r"C:\x\y.csv"


def test_image_commit_stamp(monkeypatch):
    monkeypatch.setenv("PFD_CODE_COMMIT", "abc1234")
    from engine import provenance
    importlib.reload(provenance)
    try:
        assert provenance.code_commit() == "abc1234 (image)"
    finally:
        monkeypatch.delenv("PFD_CODE_COMMIT")
        importlib.reload(provenance)
