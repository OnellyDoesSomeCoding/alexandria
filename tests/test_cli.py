"""End-to-end run of the CLI against the fake site (no network)."""

import pikepdf

import mangadl.__main__ as cli
from conftest import CHAPTER_IDS, SERIES_URL


def test_full_run(tmp_path, monkeypatch, capsys, fake_site):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(cli, "Client", lambda: fake_site)

    code = cli.main([SERIES_URL, "--chapters", "2-3", "--delay", "0"])

    assert code == 0, capsys.readouterr().err
    out = tmp_path / "Gachiakuta - Ch 2-3.pdf"
    with pikepdf.open(out) as pdf:
        assert len(pdf.pages) == 4
        with pdf.open_outline() as outline:
            assert [i.title for i in outline.root] == ["Chapter 2", "Chapter 3"]
    assert not (tmp_path / ".mangadl-tmp").exists()  # images deleted after success
    assert not any(CHAPTER_IDS[1] in url for url in fake_site.calls)  # chapter 1 never fetched


def test_list(monkeypatch, capsys, fake_site):
    monkeypatch.setattr(cli, "Client", lambda: fake_site)
    assert cli.main([SERIES_URL, "--list"]) == 0
    out = capsys.readouterr().out
    assert "Chapter 1" in out and "Side Story" in out
