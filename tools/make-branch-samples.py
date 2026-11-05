# -*- coding: utf-8 -*-
"""
「1つのPDFに複数の枝番がまとめてスキャンされている」場合の試験用サンプルを作る。

  python tools/make-branch-samples.py [出力先フォルダ]   （既定: tmp/枝番サンプル）

すべて架空の事件・当事者で、実在の案件データは含まない。
スキャンした紙に近づけるため、ページは画像（150dpi・グレー）として描き、画像だけのPDFにする
（AIは文字を画像として読む＝実際のスキャンと同じ条件になる）。
フォントは Windows 標準の游明朝を使う。
"""
import os
import sys
import zlib

from PIL import Image, ImageDraw, ImageFont

sys.stdout.reconfigure(encoding="utf-8")

DPI = 150
W, H = int(210 / 25.4 * DPI), int(297 / 25.4 * DPI)  # A4縦
FONT_DIR = r"C:\Windows\Fonts"
MINCHO = os.path.join(FONT_DIR, "yumin.ttf")
MINCHO_B = os.path.join(FONT_DIR, "yumindb.ttf")


def font(size, bold=False):
    return ImageFont.truetype(MINCHO_B if bold else MINCHO, size)


class Page:
    """A4の1ページ。y は上端からのピクセル。"""

    def __init__(self):
        self.img = Image.new("L", (W, H), 250)  # 真っ白ではなく、わずかに紙の色
        self.d = ImageDraw.Draw(self.img)
        self.y = 150

    def text(self, s, size=26, x=140, bold=False, align="left", gap=1.7):
        f = font(size, bold)
        for line in s.split("\n"):
            w = self.d.textlength(line, font=f)
            px = {"left": x, "center": (W - w) / 2, "right": W - 140 - w}[align]
            self.d.text((px, self.y), line, fill=30, font=f)
            self.y += int(size * gap)
        return self

    def space(self, n=30):
        self.y += n
        return self

    def rule(self):
        self.d.line((140, self.y, W - 140, self.y), fill=60, width=2)
        self.y += 20
        return self

    def table(self, rows, widths, size=22, row_h=56):
        """罫線つきの表。rows は文字列のリストのリスト（1行目は見出し）。"""
        f = font(size)
        x0 = 140
        for r, row in enumerate(rows):
            x = x0
            for c, cell in enumerate(row):
                self.d.rectangle((x, self.y, x + widths[c], self.y + row_h), outline=60, width=2)
                self.d.text((x + 10, self.y + (row_h - size) / 2 - 2), cell, fill=30, font=font(size, r == 0))
                x += widths[c]
            self.y += row_h
        self.y += 20
        return self

    def footer(self, s):
        f = font(20)
        w = self.d.textlength(s, font=f)
        self.d.text(((W - w) / 2, H - 110), s, fill=60, font=f)
        return self

    def seal(self, label, x, y):
        """角印・丸印の代わりの赤い（グレー化される）印影。"""
        self.d.ellipse((x, y, x + 110, y + 110), outline=90, width=4)
        f = font(22, True)
        w = self.d.textlength(label, font=f)
        self.d.text((x + (110 - w) / 2, y + 42), label, fill=90, font=f)
        return self


def save_pdf(pages, path):
    """グレーの画像を Flate 圧縮して、画像だけのPDFを書く。
    （Pillow の PDF 保存は JPEG 圧縮が無い環境だと無圧縮になり、1ページ数MBになるため自前で書く）"""
    pw, ph = W * 72 / DPI, H * 72 / DPI  # ページの大きさ（pt）
    objs = []  # 1始まりのオブジェクト番号 = 添字+1

    def add(body):
        objs.append(body)
        return len(objs)

    catalog = add(None)
    pages_obj = add(None)
    kids = []
    for p in pages:
        data = zlib.compress(p.img.tobytes(), 9)
        img = add(b"<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace /DeviceGray "
                  b"/BitsPerComponent 8 /Filter /FlateDecode /Length %d >>\nstream\n" % (W, H, len(data))
                  + data + b"\nendstream")
        content = b"q %.2f 0 0 %.2f 0 0 cm /Im0 Do Q" % (pw, ph)
        cs = add(b"<< /Length %d >>\nstream\n" % len(content) + content + b"\nendstream")
        kids.append(add(b"<< /Type /Page /Parent %d 0 R /MediaBox [0 0 %.2f %.2f] "
                        b"/Resources << /XObject << /Im0 %d 0 R >> >> /Contents %d 0 R >>"
                        % (pages_obj, pw, ph, img, cs)))
    objs[catalog - 1] = b"<< /Type /Catalog /Pages %d 0 R >>" % pages_obj
    objs[pages_obj - 1] = (b"<< /Type /Pages /Count %d /Kids [" % len(kids)
                           + b" ".join(b"%d 0 R" % k for k in kids) + b"] >>")

    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    for i, body in enumerate(objs, 1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % i + body + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1)
    out += b"".join(b"%010d 00000 n \n" % o for o in offsets)
    out += b"trailer\n<< /Size %d /Root %d 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, catalog, xref)
    with open(path, "wb") as f:
        f.write(out)
    print(f"  作成: {os.path.basename(path)}（{len(pages)}ページ・{len(out) // 1024}KB）")


# ---------------------------------------------------------------------------
# 共通の書類
# ---------------------------------------------------------------------------
SELLER = "株式会社アルファ商事"   # 原告（架空）
BUYER = "ベータ工業株式会社"      # 被告（架空）


def invoice_pages():
    """請求書（3ページ・「1/3」のページ番号つき）。"""
    pages = []
    items = [
        ("業務用エアコン　ＡＣ－５００", "4", "380,000", "1,520,000"),
        ("室外機架台", "4", "45,000", "180,000"),
        ("配管部材一式", "1", "210,000", "210,000"),
        ("取付工事費", "1", "640,000", "640,000"),
    ]
    p = Page()
    p.text("請　求　書", 48, bold=True, align="center").space(40)
    p.text("令和７年１０月３１日", 24, align="right")
    p.text("請求番号　Ｓ－２０２５－１０４", 24, align="right").space(20)
    p.text(f"{BUYER}　御中", 30, bold=True).space(20)
    p.text("下記のとおりご請求申し上げます。", 24).space(20)
    p.text("ご請求金額　金２，８３８，０００円（税込）", 32, bold=True).space(30)
    p.table([["品名", "数量", "単価", "金額"]] + [list(i) for i in items], [460, 120, 180, 200])
    p.text(f"{SELLER}", 26, align="right")
    p.text("東京都千代田区架空町一丁目２番３号", 22, align="right")
    p.seal("アルファ", W - 300, p.y + 10)
    p.footer("1 / 3")
    pages.append(p)

    p = Page()
    p.text("（請求書・内訳明細）", 28, bold=True, align="center").space(30)
    p.table([["日付", "内容", "金額"],
             ["10月 6日", "現地調査・採寸", "0"],
             ["10月14日", "機器搬入（エアコン４台）", "1,520,000"],
             ["10月15日", "架台設置・配管", "390,000"],
             ["10月16日", "取付工事・試運転", "640,000"],
             ["", "小計", "2,550,000"],
             ["", "消費税（10％）", "255,000"],
             ["", "合計（送料等込み）", "2,838,000"]], [200, 520, 240])
    p.footer("2 / 3")
    pages.append(p)

    p = Page()
    p.text("（請求書・お支払い条件）", 28, bold=True, align="center").space(30)
    p.text("１　お支払期限　令和７年１１月３０日", 24)
    p.text("２　お振込先　　架空銀行　本店営業部　普通　１２３４５６７", 24)
    p.text("　　　　　　　　口座名義　カ）アルファショウジ", 24)
    p.text("３　振込手数料は貴社にてご負担ください。", 24).space(40)
    p.text("以上", 24, align="right")
    p.footer("3 / 3")
    pages.append(p)
    return pages


def receipt_pages():
    """領収書（2ページ）。請求書とは書式・表題が違う。"""
    p = Page()
    p.text("領　収　書", 52, bold=True, align="center").space(60)
    p.text(f"{BUYER}　様", 32, bold=True).space(40)
    p.text("金　１，０００，０００円也", 44, bold=True, align="center").space(30)
    p.text("但　業務用エアコン設置工事代金の内金として", 26, align="center")
    p.text("上記正に領収いたしました。", 26, align="center").space(60)
    p.text("令和７年１１月２８日", 26, align="right").space(20)
    p.text(f"{SELLER}", 28, align="right")
    p.text("経理部　担当　佐藤", 24, align="right")
    p.seal("領収", W - 300, p.y + 20)
    receipt = [p]

    p = Page()
    p.text("（領収書・控えの添付）", 28, bold=True, align="center").space(30)
    p.text("振込受付記録", 26, bold=True).space(10)
    p.table([["受付日", "振込人", "金額"],
             ["令和７年１１月２８日", "ベータコウギョウ（カ", "1,000,000"]], [320, 400, 240])
    p.text("残額　金１，８３８，０００円は未払いです。", 26)
    receipt.append(p)
    return receipt


def line_pages(n=3):
    """LINEのトーク画面を印刷したもの（同じ書式が続く＝区切りの手がかりが無い）。"""
    talks = [
        [("ベータ工業　田中", "エアコンの件、残金は来月まとめて払います"),
         ("アルファ商事　鈴木", "承知しました。11月末までにお願いします"),
         ("ベータ工業　田中", "了解です")],
        [("アルファ商事　鈴木", "11月末を過ぎましたが、ご入金が確認できていません"),
         ("ベータ工業　田中", "社内で確認中です。少しお待ちください"),
         ("アルファ商事　鈴木", "いつ頃になりますか")],
        [("アルファ商事　鈴木", "年内にお支払いいただけない場合は法的手続を検討します"),
         ("ベータ工業　田中", "工事に不具合があるので、残金は払えません"),
         ("アルファ商事　鈴木", "不具合のご連絡はこれまで一度もいただいていません")],
    ]
    pages = []
    for i in range(n):
        p = Page()
        p.text("トーク履歴", 30, bold=True, align="center").space(20)
        for who, msg in talks[i % len(talks)]:
            p.text(who, 22)
            p.d.rounded_rectangle((160, p.y, W - 300, p.y + 80), radius=24, outline=90, width=2)
            p.d.text((185, p.y + 24), msg, fill=30, font=font(24))
            p.y += 120
        pages.append(p)
    return pages


def contract_pages():
    """売買契約書（2ページで1つの書類＝分けてはいけない対照）。"""
    p = Page()
    p.text("売　買　契　約　書", 46, bold=True, align="center").space(40)
    p.text(f"売主　{SELLER}（以下「甲」という。）と買主　{BUYER}（以下「乙」という。）は、", 23)
    p.text("次のとおり売買契約を締結する。", 23).space(20)
    for s in ["第１条（目的）　甲は乙に対し、業務用エアコン４台を売り渡し、その取付工事を行う。",
              "第２条（代金）　代金は金２，８３８，０００円（税込）とする。",
              "第３条（支払）　乙は、工事完了の月の末日までに代金を支払う。",
              "第４条（検査）　乙は、工事完了後７日以内に検査し、不具合があれば甲に通知する。"]:
        p.text(s, 23)
    p.footer("- 1 -")
    q = Page()
    for s in ["第５条（遅延損害金）　乙が代金の支払を遅滞したときは、年３％の割合による",
              "　　　　　　　　　　　遅延損害金を支払う。",
              "第６条（管轄）　本契約に関する紛争は、東京地方裁判所を第一審の専属的合意管轄",
              "　　　　　　　　裁判所とする。"]:
        q.text(s, 23)
    q.space(40).text("令和７年９月１日", 24, align="right").space(30)
    q.text(f"甲　{SELLER}　代表取締役　架空　一郎", 24, align="right")
    q.text(f"乙　{BUYER}　代表取締役　仮名　二郎", 24, align="right")
    q.seal("甲印", W - 420, q.y + 20).seal("乙印", W - 280, q.y + 20)
    q.footer("- 2 -")
    return [p, q]


def brief_pages():
    """準備書面（枝番を引用している）。"""
    p = Page()
    p.text("令和８年（ワ）第１２３号　売買代金請求事件", 22)
    p.text(f"原告　{SELLER}", 22)
    p.text(f"被告　{BUYER}", 22).space(30)
    p.text("原告第１準備書面", 40, bold=True, align="center").space(30)
    p.text("令和８年２月１０日", 22, align="right")
    p.text("東京地方裁判所民事第●部　御中", 24).space(10)
    p.text("原告訴訟代理人弁護士　山田　太郎", 24, align="right").space(30)
    p.text("第１　契約の成立", 26, bold=True)
    p.text("　原告と被告は、令和７年９月１日、業務用エアコン４台の売買及び取付工事に", 23)
    p.text("ついて、代金２８３万８０００円とする売買契約を締結した（甲１）。", 23).space(20)
    p.text("第２　代金の請求と一部弁済", 26, bold=True)
    p.text("　原告は、工事完了後の令和７年１０月３１日、被告に対し代金を請求し", 23)
    p.text("（請求書・甲２の１）、被告は同年１１月２８日、内金１００万円を支払った", 23)
    p.text("（領収書・甲２の２）。", 23).space(20)
    p.text("第３　被告の主張に対する反論", 26, bold=True)
    p.text("　被告は工事の不具合を主張するが、被告から不具合の通知を受けたことは", 23)
    p.text("一度もない（ＬＩＮＥのやりとり・甲３）。", 23)
    p.footer("1")
    q = Page()
    q.text("第４　結論", 26, bold=True)
    q.text("　よって、原告は被告に対し、残代金１８３万８０００円及び遅延損害金の", 23)
    q.text("支払を求める。", 23).space(40)
    q.text("以上", 24, align="right")
    q.footer("2")
    return [p, q]


def explanation_pages():
    """証拠説明書（枝番ごとの行がある）。"""
    p = Page()
    p.text("令和８年（ワ）第１２３号　売買代金請求事件", 22)
    p.text(f"原告　{SELLER}　／　被告　{BUYER}", 22).space(20)
    p.text("証 拠 説 明 書", 40, bold=True, align="center").space(20)
    p.text("令和８年２月１０日", 22, align="right")
    p.text("原告訴訟代理人弁護士　山田　太郎", 22, align="right").space(20)
    p.table([["号証", "標目", "作成年月日", "作成者", "立証趣旨"],
             ["甲１", "売買契約書", "R7.9.1", "原告・被告", "契約の成立"],
             ["甲２の１", "見積書", "R7.8.20", "原告", "見積金額"],
             ["甲２の２", "注文書", "R7.8.25", "被告", "被告の注文"],
             ["甲２の３", "納品書", "R7.10.16", "原告", "納品の事実"]],
            [130, 200, 160, 180, 270], size=20, row_h=58)
    return [p]


def estimate_page():
    p = Page()
    p.text("御　見　積　書", 46, bold=True, align="center").space(40)
    p.text("令和７年８月２０日", 24, align="right").space(20)
    p.text(f"{BUYER}　御中", 30, bold=True).space(20)
    p.text("御見積金額　金２，８３８，０００円（税込）", 32, bold=True).space(30)
    p.table([["品名", "数量", "金額"],
             ["業務用エアコン　ＡＣ－５００", "4", "1,520,000"],
             ["架台・配管・工事一式", "1", "1,030,000"]], [560, 160, 240])
    p.text("有効期限　見積日から３０日", 22)
    p.text(f"{SELLER}", 26, align="right")
    p.seal("アルファ", W - 300, p.y + 10)
    return [p]


def order_pages():
    """注文書（2ページ）。"""
    p = Page()
    p.text("注　文　書", 46, bold=True, align="center").space(40)
    p.text("令和７年８月２５日", 24, align="right").space(20)
    p.text(f"{SELLER}　御中", 30, bold=True).space(20)
    p.text("貴社御見積書（令和７年８月２０日付）のとおり注文いたします。", 24).space(20)
    p.table([["品名", "数量"],
             ["業務用エアコン　ＡＣ－５００（取付工事込み）", "4"]], [760, 200])
    p.footer("注文書　1/2")
    q = Page()
    q.text("（注文書・納入条件）", 28, bold=True, align="center").space(30)
    q.text("納入場所　当社本社工場（神奈川県架空市二丁目３番）", 24)
    q.text("納　　期　令和７年１０月中旬", 24).space(40)
    q.text(f"{BUYER}", 26, align="right")
    q.text("購買部長　仮名　三郎", 24, align="right")
    q.seal("ベータ", W - 300, q.y + 10)
    q.footer("注文書　2/2")
    return [p, q]


def delivery_page():
    p = Page()
    p.text("納　品　書", 46, bold=True, align="center").space(40)
    p.text("令和７年１０月１６日", 24, align="right").space(20)
    p.text(f"{BUYER}　御中", 30, bold=True).space(20)
    p.text("下記のとおり納品いたしました。", 24).space(20)
    p.table([["品名", "数量", "備考"],
             ["業務用エアコン　ＡＣ－５００", "4", "取付・試運転済み"]], [520, 160, 280])
    p.text("受領印", 22, x=140)
    p.d.rectangle((140, p.y, 300, p.y + 120), outline=60, width=2)
    p.d.text((160, p.y + 45), "田中", fill=90, font=font(28, True))
    p.y += 140
    p.text(f"{SELLER}", 26, align="right")
    return [p]


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join("tmp", "枝番サンプル")
    a = os.path.join(out, "セットA_準備書面で枝番を引用")
    b = os.path.join(out, "セットB_証拠説明書あり")
    for d in (a, b):
        os.makedirs(d, exist_ok=True)

    print(f"出力先: {os.path.abspath(out)}")
    print("[セットA]")
    save_pdf(brief_pages(), os.path.join(a, "原告第1準備書面.pdf"))
    save_pdf(contract_pages(), os.path.join(a, "甲1_売買契約書.pdf"))
    save_pdf(invoice_pages() + receipt_pages(), os.path.join(a, "甲2.pdf"))
    save_pdf(line_pages(3), os.path.join(a, "甲3.pdf"))
    print("[セットB]")
    save_pdf(explanation_pages(), os.path.join(b, "証拠説明書(甲1～甲2).pdf"))
    save_pdf(contract_pages(), os.path.join(b, "甲1.pdf"))
    save_pdf(estimate_page() + order_pages() + delivery_page(), os.path.join(b, "甲2.pdf"))

    with open(os.path.join(out, "正解.txt"), "w", encoding="utf-8") as f:
        f.write(ANSWERS)
    print("  作成: 正解.txt")


ANSWERS = """枝番サンプルの正解（すべて架空の事件・当事者です）

■ セットA_準備書面で枝番を引用
  ・甲1_売買契約書.pdf（2ページ）
      2ページで1つの書類。枝番に分けてはいけない（対照用）。
  ・甲2.pdf（5ページ）
      1〜3ページ目 ＝ 甲2の1　請求書（ページ下に「1 / 3」〜「3 / 3」）
      4〜5ページ目 ＝ 甲2の2　領収書
      手がかり: 準備書面の「請求書・甲２の１」「領収書・甲２の２」、4ページ目から表題と書式が変わる。
      → 入力欄の正解: 1-3, 4-5
  ・甲3.pdf（3ページ）
      LINEのトーク画面が3枚。準備書面は「甲３」とだけ引用している。
      → 枝番に分けない（AIが推測で区切らず、確認に回すのが正しい動き）。

■ セットB_証拠説明書あり
  ・証拠説明書(甲1～甲2).pdf
      甲1 売買契約書／甲2の1 見積書／甲2の2 注文書／甲2の3 納品書
  ・甲1.pdf（2ページ） … 分けない。
  ・甲2.pdf（4ページ）
      1ページ目   ＝ 甲2の1　見積書
      2〜3ページ目 ＝ 甲2の2　注文書（「注文書 1/2」「2/2」）
      4ページ目   ＝ 甲2の3　納品書
      → 入力欄の正解: 1, 2-3, 4
      → 説明書に甲2の1〜3があり、ファイルが1つにまとまっているだけなので「ファイルが足りない」警告は出ないのが正しい。

試し方
  1. セットごとに、フォルダのファイル一式とアプリの「プロンプトをコピー」の内容をAIへ渡す。
  2. 返ってきたJSONをアプリに貼り、確認画面で甲2を選んで「ページで枝番に分ける」を押す。
  3. 入力欄に上の正解が入っているか、確認メッセージに区切りと根拠が書かれているかを見る。
  4. 分けたあとプレビューで、各枝番の先頭ページにだけ「甲第2号証の1」などが押されているかを見る。
"""

if __name__ == "__main__":
    main()
