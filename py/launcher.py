# -*- coding: utf-8 -*-
"""配布用 exe の入口（PyInstaller はパッケージではなくスクリプトを入口に取るため）。"""
from legalleaves.app import main

if __name__ == "__main__":
    main()
