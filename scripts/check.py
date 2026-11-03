"""Verify static migration integrity without third-party dependencies."""
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit, unquote
import re

ROOT = Path(__file__).resolve().parents[1] / 'public'
errors = []
class Page(HTMLParser):
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        for attr in ('src', 'href', 'poster'):
            value = attrs.get(attr, '')
            url = urlsplit(value)
            if value.startswith('/') and not value.startswith('//'):
                path = ROOT / unquote(url.path.lstrip('/'))
                if not path.is_file() and not (path / 'index.html').is_file():
                    errors.append(f'{self.file}: missing {value}')
            if attr in ('src', 'poster') and 'squarespace' in url.netloc:
                errors.append(f'{self.file}: hosted Squarespace dependency {value}')
        if tag == 'a':
            href = attrs.get('href', '')
            if any(term in href for term in ('/orderhardware', '/cart', '/checkout', '#MENU', 'fullspec710.com/drops', 'cookies.co/catalog')):
                errors.append(f'{self.file}: excluded link {href}')
        if tag == 'iframe' and not attrs.get('title'):
            errors.append(f'{self.file}: iframe missing title')

for file in ROOT.rglob('*'):
    if not file.is_file():
        continue
    if file.stat().st_size > 25 * 1024 * 1024:
        errors.append(f'{file}: exceeds Cloudflare Pages 25 MiB asset limit')
    if file.suffix == '.html':
        parser = Page(); parser.file = str(file.relative_to(ROOT)); parser.feed(file.read_text())
    if file.suffix in ('.html', '.css'):
        for url in re.findall(r'url\([\'\"]?(/assets/[^\'\")]+)', file.read_text()):
            if not (ROOT / url.lstrip('/')).is_file():
                errors.append(f'{file}: missing CSS asset {url}')
        if re.search(r'url\([\'\"]?https?://[^\'\")]*squarespace', file.read_text()):
            errors.append(f'{file}: remote Squarespace CSS dependency')

assert (ROOT / 'assets/sungrown-film.mp4').stat().st_size > 100000, 'Company film missing'
if errors:
    raise SystemExit('\n'.join(errors))
print('PASS: all local page, image, font, stylesheet, video and CSS references resolve;')
print('no excluded commerce links or Squarespace runtime assets; files fit Pages limits.')
