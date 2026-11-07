# -*- coding: utf-8 -*-
"""
音声・動画を mints・TreeeS に出せる形（音声 .mp3・動画 .mp4）にする。v5.4.0

- パソコンの中だけで変換する（外部へは何も送らない）。部品は同梱の ffmpeg（LGPL 版・DLL 分割）。
- 変換するとき、撮影場所（GPS）・作成者・作成日時などの情報（メタデータ）と、
  字幕・チャプター・付属のデータの流れは入れない。もともと .mp3・.mp4 のものも、中身はそのまま（再圧縮せず）
  情報だけを外して写す。
- 動画は Windows の符号化器（Media Foundation の H.264・AAC）で作る（特許の許諾が OS 側で済んでいるため）。
  使えないパソコン（Windows の N エディション等）では、同梱の OpenH264・AAC に切り替える。
- 音声は LAME（mp3）。mp3 の特許は切れている。
- 元のファイルは書き換えない。書き出しは同じフォルダの一時ファイルに作ってから名前を変える（途中で止まっても壊れた
  ファイルを残さない）。

部品の場所: 開発時は LegalLeaves/vendor/ffmpeg/（tools/fetch-ffmpeg.py で取得・リポジトリには入れない）、
配布物では _internal/vendor/ffmpeg/。
"""
import json
import os
import subprocess
import threading

from . import paths

CREATE_NO_WINDOW = 0x08000000

AUDIO_OUT = ".mp3"
VIDEO_OUT = ".mp4"
# 変換して出す形式（読み込みで受け付ける）
AUDIO_CONVERT_EXTS = {".wav", ".m4a", ".aac", ".flac", ".ogg", ".oga", ".opus", ".wma", ".aiff", ".aif", ".amr"}
VIDEO_CONVERT_EXTS = {".mov", ".avi", ".wmv", ".mkv", ".m4v", ".flv", ".webm", ".3gp", ".3g2", ".mpeg", ".mpg",
                      ".mts", ".m2ts", ".ts", ".vob"}
CONVERT_EXTS = AUDIO_CONVERT_EXTS | VIDEO_CONVERT_EXTS
# 動画の長い辺の上限（4K などは 1920 に縮める。mints の一度のアップロードの上限 200MB を超えにくくするため）
MAX_LONG_SIDE = 1920
HDR_TRANSFERS = {"smpte2084", "arib-std-b67"}  # HDR（PQ・HLG）。SDR へ色を合わせてから 8bit にする


def _ext(p):
    return os.path.splitext(str(p or ""))[1].lower()


def target_ext(path):
    """提出するときの拡張子（.mp3 / .mp4）。音声・動画でなければ None。"""
    e = _ext(path)
    if e == AUDIO_OUT or e in AUDIO_CONVERT_EXTS:
        return AUDIO_OUT
    if e == VIDEO_OUT or e in VIDEO_CONVERT_EXTS:
        return VIDEO_OUT
    return None


def needs_conversion(path):
    return _ext(path) in CONVERT_EXTS


def ffmpeg_dir():
    return paths.resource_path("vendor", "ffmpeg")


def _exe(name):
    return os.path.join(ffmpeg_dir(), name)


def available():
    return os.path.isfile(_exe("ffmpeg.exe")) and os.path.isfile(_exe("ffprobe.exe"))


def probe(path):
    """長さ（秒）と、最初の映像・音声の様子。読めなければ例外。"""
    r = subprocess.run([_exe("ffprobe.exe"), "-v", "error", "-show_format", "-show_streams", "-of", "json", path],
                       capture_output=True, creationflags=CREATE_NO_WINDOW, timeout=120)
    if r.returncode != 0:
        raise RuntimeError(_tail(r.stderr) or "音声・動画として読めませんでした")
    d = json.loads(r.stdout.decode("utf-8", "replace") or "{}")
    streams = d.get("streams") or []
    video = next((s for s in streams if s.get("codec_type") == "video"
                  and not (s.get("disposition") or {}).get("attached_pic")), None)
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)
    try:
        duration = float((d.get("format") or {}).get("duration") or 0)
    except ValueError:
        duration = 0.0
    return {"duration": duration, "video": video, "audio": audio}


def _parse_when(v):
    """日時の文字列 → 手元の時刻の datetime（読めなければ None）。
    Z・+0900・+09:00 付きは手元の時刻へ直す。付いていないものはそのまま手元の時刻とみなす。"""
    from datetime import datetime
    v = str(v or "").strip()
    if not v:
        return None
    t = v.replace("Z", "+00:00")
    if len(t) >= 5 and t[-5] in "+-" and t[-4:].isdigit():  # +0900 → +09:00
        t = t[:-2] + ":" + t[-2:]
    if "." in t[19:]:  # 小数の秒は捨てる（タイムゾーンは残す）
        head, rest = t[:19], t[19:]
        tz = rest[rest.find("+"):] if "+" in rest else (rest[rest.find("-"):] if "-" in rest else "")
        t = head + tz
    try:
        d = datetime.fromisoformat(t.replace(" ", "T", 1))
    except ValueError:
        return None
    if d.year < 1980:  # 0 や 1904 年（日時が入っていないときの値）は使わない
        return None
    if d.tzinfo is not None:
        try:
            d = d.astimezone().replace(tzinfo=None)
        except (OSError, OverflowError, ValueError):
            return None
    return d


def recorded_info(path):
    """撮影・録音の日時（ファイルの中の情報）と、撮影場所の情報の有無。v5.4.4
    確認画面で作成年月日（撮影日・録音日）の下書きにするため、変換で消す前に読む。

    - recordedAt: カメラ・録音アプリが「撮った時刻」として残す記録（写真の EXIF にあたるもの。
      iPhone・iPad の com.apple.quicktime.creationdate）だけ。下書きに使うのはこれだけ（v5.4.5）。
    - fileTime: 入れ物（ファイル）の作成日時 creation_time。録画を止めた時刻のことも、書き出し・
      変換・送った時刻のこともあり、撮った日の裏付けにならないので、下書きには使わない（消す情報として見せるだけ）。
    どちらも書き換えられるので、下書き（人が確かめる）にしか使わない。"""
    r = subprocess.run([_exe("ffprobe.exe"), "-v", "error", "-show_entries", "format_tags:stream_tags",
                        "-of", "json", path], capture_output=True, creationflags=CREATE_NO_WINDOW, timeout=60)
    if r.returncode != 0:
        return {"recordedAt": None, "hasLocation": False}
    d = json.loads(r.stdout.decode("utf-8", "replace") or "{}")
    tag_sets = [(d.get("format") or {}).get("tags") or {}]
    tag_sets += [(st.get("tags") or {}) for st in (d.get("streams") or [])]
    lower = [{str(k).lower(): v for k, v in t.items()} for t in tag_sets]
    def first(key):
        for t in lower:
            w = _parse_when(t.get(key))
            if w:
                return w
        return None

    when = first("com.apple.quicktime.creationdate")
    file_time = first("creation_time") or first("date")
    has_loc = any(k in t for t in lower for k in ("location", "com.apple.quicktime.location.iso6709", "location-eng"))
    fmt = lambda w: w.strftime("%Y-%m-%dT%H:%M") if w else None  # noqa: E731
    return {"recordedAt": fmt(when), "fileTime": fmt(file_time), "hasLocation": has_loc}


def _tail(b, n=300):
    s = (b or b"").decode("utf-8", "replace").strip() if isinstance(b, bytes) else str(b or "").strip()
    return s[-n:]


def _video_bitrate(height):
    if height <= 480:
        return "1500k"
    if height <= 720:
        return "3000k"
    return "5000k"


def _video_filter(video):
    """縮小（長い辺 1920 まで）と、HDR を SDR へ。最後に偶数の大きさ・8bit（nv12）にそろえる。"""
    f = []
    if (video or {}).get("color_transfer") in HDR_TRANSFERS:
        f.append("zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,"
                 "tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv")
    m = MAX_LONG_SIDE
    f.append(f"scale='if(gte(iw,ih),min(iw,{m}),-2)':'if(gte(iw,ih),-2,min(ih,{m}))'")
    f.append("scale=trunc(iw/2)*2:trunc(ih/2)*2")
    f.append("format=nv12")
    return ",".join(f)


def _out_height(video):
    w, h = int((video or {}).get("width") or 0), int((video or {}).get("height") or 0)
    if not w or not h:
        return 1080
    side = max(w, h)
    k = min(1.0, MAX_LONG_SIDE / side)
    return int(min(w, h) * k)


# 情報（メタデータ）を入れない共通の指定
_STRIP = ["-map_metadata", "-1", "-map_chapters", "-1", "-dn", "-sn"]


def _plans(src, info):
    """試す順の ffmpeg の引数（出力ファイルの前まで）。最初が失敗したら次を試す。"""
    e = _ext(src)
    target = target_ext(src)
    if target == AUDIO_OUT:
        if not info["audio"]:
            raise RuntimeError("音声が入っていません")
        tail = ["-vn", *_STRIP, "-id3v2_version", "0", "-write_id3v1", "0", "-f", "mp3"]
        if e == AUDIO_OUT:  # もともと mp3: 再圧縮せず情報だけ外す
            return [["-map", "0:a:0", "-c:a", "copy", *tail]]
        return [["-map", "0:a:0", "-c:a", "libmp3lame", "-q:a", "4", *tail]]
    if not info["video"]:
        raise RuntimeError("映像が入っていません")
    maps = ["-map", "0:v:0", "-map", "0:a:0?"]
    tail = [*_STRIP, "-movflags", "+faststart", "-f", "mp4"]
    if e == VIDEO_OUT:  # もともと mp4: 再圧縮せず情報だけ外す（向きの情報は残る）
        return [[*maps, "-c", "copy", *tail]]
    vf = ["-vf", _video_filter(info["video"])]
    br = ["-b:v", _video_bitrate(_out_height(info["video"]))]
    audio = ["-ac", "2", "-ar", "48000", "-b:a", "128k"]
    return [
        [*maps, *vf, "-c:v", "h264_mf", *br, "-c:a", "aac_mf", *audio, *tail],  # Windows の符号化器
        [*maps, *vf, "-c:v", "libopenh264", *br, "-c:a", "aac", *audio, *tail],  # 使えないときの代わり
    ]


def convert(src, dest, on_progress=None, cancel=None):
    """src を提出できる形にして dest へ書く。on_progress(0.0〜1.0)。cancel は threading.Event（任意）。"""
    if not available():
        raise RuntimeError("音声・動画の変換の部品が見つかりません。アプリを入れ直してください。")
    info = probe(src)
    duration = info["duration"] or 0.0
    d = os.path.dirname(dest) or "."
    tmp = os.path.join(d, f".~{os.path.basename(dest)}.part")
    last_err = ""
    for plan in _plans(src, info):
        args = [_exe("ffmpeg.exe"), "-hide_banner", "-nostdin", "-y", "-loglevel", "error",
                "-progress", "pipe:1", "-nostats", "-i", src, *plan, tmp]
        p = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, creationflags=CREATE_NO_WINDOW)
        err_chunks = []
        t = threading.Thread(target=lambda: err_chunks.append(p.stderr.read()), daemon=True)
        t.start()
        for raw in p.stdout:
            if cancel is not None and cancel.is_set():
                p.kill()
                break
            line = raw.decode("ascii", "replace").strip()
            if on_progress and duration and line.startswith("out_time_us="):
                try:
                    on_progress(max(0.0, min(1.0, int(line.split("=", 1)[1]) / 1e6 / duration)))
                except ValueError:
                    pass
        p.wait()
        t.join(timeout=5)
        if cancel is not None and cancel.is_set():
            _remove(tmp)
            raise RuntimeError("変換を取り消しました")
        if p.returncode == 0 and os.path.isfile(tmp) and os.path.getsize(tmp) > 0:
            os.replace(tmp, dest)
            if on_progress:
                on_progress(1.0)
            return {"converted": needs_conversion(src)}
        last_err = _tail(b"".join(c or b"" for c in err_chunks))
        _remove(tmp)
    raise RuntimeError(f"音声・動画を変換できませんでした（{last_err or '原因不明'}）")


def _remove(p):
    try:
        os.remove(p)
    except OSError:
        pass
