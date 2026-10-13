"""米子市の月別PDFを、罫線セル・日番号・品目文字の座標から抽出する。"""
import calendar
import datetime
import json
import pathlib
import re
import sys
import unicodedata

import pdfplumber
from pdfplumber.utils import extract_text, extract_words


def norm(text):
    return re.sub(r'\s+', '', unicodedata.normalize('NFKC', text))


ITEMS = {
    '可燃ごみ': ['burnable'],
    '不燃ごみ': ['non_burnable'],
    '不燃性粗大ごみ': ['oversized'],
    '白色発泡スチロール・トレー': ['plastic'],
    '缶・ビン類': ['beverage_can', 'glass_bottle'],
    'ペットボトル': ['pet_bottle'],
    '古紙類': ['paper'],
    '乾電池・リチウムイオン充電池類': ['hazardous'],
    '蛍光管等': ['hazardous'],
}


def extract_pdf(path):
    events, closed, pages = {}, [], []
    with pdfplumber.open(path) as pdf:
        if len(pdf.pages) != 13:
            raise ValueError(f'{path.name}: PDFは13ページのはず')
        cover = norm(pdf.pages[0].extract_text())
        if '令和8年4月〜令和9年3月' not in cover:
            raise ValueError(f'{path.name}: 表紙の対象期間が変わった')
        for pi in range(1, 13):
            page = pdf.pages[pi]
            month = (pi + 2) % 12 + 1
            year = 2026 if month >= 4 else 2027
            frames = [r for r in page.rects if r['width'] > 500 and r['height'] > 300 and r['x0'] < 20 and r['x1'] < 600 and r['linewidth'] > 1]
            if len(frames) != 1:
                raise ValueError(f'{path.name} p{pi+1}: カレンダーの外枠が一意でない')
            frame = frames[0]
            x0, x1, bottom = frame['x0'], frame['x1'], frame['bottom']
            lines = [line for line in page.lines if line['stroking_color'] == frame['stroking_color'] and x0-1 <= line['x0'] <= x1+1 and frame['top']-1 <= line['top'] <= bottom+1]
            xs = sorted(set([round(x0, 2), round(x1, 2)] + [round(line['x0'], 2) for line in lines if line['width'] < 0.1]))
            ys = sorted(set([round(bottom, 2)] + [round(line['top'], 2) for line in lines if line['width'] > 500]))
            if len(xs) != 8 or len(ys) != 6:
                raise ValueError(f'{path.name} p{pi+1}: 日付罫線が7列×5段ではない {xs} / {ys}')
            top = ys[0]
            cells = [(xs[col], ys[row], xs[col+1], ys[row+1]) for row in range(5) for col in range(7)]
            date_chars = [c for c in page.chars if x0 <= c['x0'] < x1 and top <= c['top'] < bottom
                          and 'KozGoPro-Heavy' in c['fontname'] and 20 < c['size'] < 24
                          and re.fullmatch('[0-9０-９]', c['text'])]
            anchors = extract_words(date_chars, x_tolerance=3, y_tolerance=2)
            day_numbers = [int(norm(a['text'])) for a in anchors]
            if sorted(day_numbers) != list(range(1, calendar.monthrange(year, month)[1] + 1)):
                raise ValueError(f'{path.name} {year}-{month}: 日番号に重複・欠落 {day_numbers}')
            day_records, bands = [], []
            for a in anchors:
                day = int(norm(a['text']))
                date = datetime.date(year, month, day)
                matches = [cell for cell in cells if cell[0] <= a['x0'] < cell[2] and cell[1] <= a['top'] < cell[3]]
                if len(matches) != 1:
                    raise ValueError(f'{path.name} {date}: 日番号のセルが一意でない')
                cell = matches[0]
                col = xs.index(cell[0])
                if col != (date.weekday() + 1) % 7:
                    raise ValueError(f'{path.name} {date}: 曜日と列が不一致')
                other = [b for b in anchors if cell[0] <= b['x0'] < cell[2] and a['top'] + 2 < b['top'] < cell[3]]
                lower = min([b['top'] for b in other], default=cell[3])
                chars = [c for c in page.chars if cell[0] <= c['x0'] < cell[2] and a['top'] <= c['top'] < lower]
                text = norm(extract_text(chars, x_tolerance=1, y_tolerance=2))
                battery = '電池類蛍光管等' in text
                label_chars = [c for c in chars if 'UDShinGoPro-Bold' in c['fontname'] and abs(c['size'] - 10.63) < 0.05]
                labels_text = norm(extract_text(label_chars, x_tolerance=1, y_tolerance=2))
                if text.count('●') != labels_text.count('●'):
                    raise ValueError(f'{path.name} {date}: 品目のフォント・サイズが変わった')
                labels = re.findall(r'●([^●]+)', labels_text)
                cats = ['hazardous'] if battery else []
                for label in labels:
                    if label not in ITEMS:
                        raise ValueError(f'{path.name} {date}: 未知の品目 {label!r} ({text!r})')
                    cats.extend(ITEMS[label])
                cats = sorted(set(cats))
                cancelled = '収集はありません' in text
                if cancelled and cats:
                    raise ValueError(f'{path.name} {date}: 休止と品目が共存')
                if cancelled:
                    closed.append(date.isoformat())
                events[date.isoformat()] = cats
                day_records.append({'date': date.isoformat(), 'labels': labels, 'closed': cancelled})
                bands.append((date.isoformat(), cell[0], cell[2], a['top'], lower))
            # 大和の元日〜1/2など、収集なしの帯が2列にまたがる場合も文字列を途中で切らない。
            for notice in page.search('収集はありません'):
                for date, left, right, upper, lower in bands:
                    if upper <= notice['top'] < lower and max(left, notice['x0']) < min(right, notice['x1']):
                        if events[date]:
                            raise ValueError(f'{path.name} {date}: 収集なしの帯と品目が共存')
                        closed.append(date)
                        next(d for d in day_records if d['date'] == date)['closed'] = True
            pages.append({'page': pi + 1, 'month': f'{year}-{month:02}', 'days': sorted(day_records, key=lambda d: d['date'])})
    if len(events) != 365:
        raise ValueError(f'{path.name}: 365日を覆っていない')
    return {'file': path.name, 'events': dict(sorted(events.items())), 'closed': sorted(set(closed)), 'pages': pages}


def main():
    cache = pathlib.Path(sys.argv[1])
    manifest = json.loads((cache / 'manifest.json').read_text(encoding='utf-8'))
    courses = [extract_pdf(cache / item['file']) for item in manifest]
    (cache / 'extracted.json').write_text(json.dumps(courses, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'extracted {len(courses)} PDFs / {len(courses) * 365} day slots')


if __name__ == '__main__':
    main()
