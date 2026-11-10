#!/usr/bin/env python3
"""Render the architecture overview to a standalone offline HTML document.

Requires Python packages: markdown, beautifulsoup4.
Run: python3 tools/render-notifs-design.py
"""
from pathlib import Path
from html import escape
import markdown
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'docs/design/notifs.md'
TARGET = SOURCE.with_suffix('.html')
source = SOURCE.read_text(encoding='utf-8')
soup = BeautifulSoup(markdown.markdown(source, extensions=['tables', 'fenced_code']), 'html.parser')
if soup.h1:
    soup.h1.decompose()
if soup.blockquote:
    soup.blockquote.decompose()
nav = []
chapter = 0
sub = 0
for heading in soup.find_all(['h2', 'h3']):
    if heading.name == 'h2':
        chapter += 1
        sub = 0
        heading['id'] = f'section-{chapter:02d}'
        title = heading.get_text()
        short = title.split('. ', 1)[-1]
        nav.append(f'<a href="#{heading["id"]}"><span>{chapter:02d}</span>{escape(short)}</a>')
    else:
        sub += 1
        heading['id'] = f'section-{chapter:02d}-{sub}'
for table in soup.find_all('table'):
    wrapper = soup.new_tag('div', attrs={'class': 'table-scroll', 'tabindex': '0', 'role': 'region', 'aria-label': '可横向滚动的数据表格'})
    table.wrap(wrapper)
    for th in table.find_all('th'):
        th['scope'] = 'col'
html = '''<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>notifs · 团队通信基础设施设计</title>
<style>
:root{--paper:#faf9f6;--card:#fff;--ink:#22323b;--muted:#65747d;--line:#dddeda;--accent:#ad4d2e;--blue:#235d71;--nav:280px}
*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:32px}body{margin:0;background:var(--paper);color:var(--ink);font-family:system-ui,-apple-system,"Noto Sans CJK SC","Microsoft YaHei",sans-serif;font-size:16px;line-height:1.9;overflow-wrap:break-word}
a{color:var(--blue);text-underline-offset:4px}a:hover{color:var(--accent)}:focus-visible{outline:3px solid #d98552;outline-offset:4px}.skip{position:fixed;left:16px;top:-100px;background:white;padding:8px;z-index:99}.skip:focus{top:12px}
.read-progress{position:fixed;top:0;left:0;right:0;height:3px;background:var(--line);z-index:50}.read-progress div{height:100%;width:0;background:var(--accent)}
aside{position:fixed;inset:0 auto 0 0;width:var(--nav);background:#f0f1ed;border-right:1px solid var(--line);padding:30px 22px 20px;overflow:auto;scrollbar-width:thin}.brand{font-size:28px;font-weight:760;letter-spacing:-1px;color:var(--ink);text-decoration:none}.brand b{color:var(--accent)}.nav-caption{font-size:12px;color:var(--muted);letter-spacing:.13em;margin:4px 0 25px}.contents summary{font-size:12px;letter-spacing:.1em;color:var(--muted);margin-bottom:12px;cursor:pointer}.contents nav{display:grid;gap:3px}.contents a{display:flex;align-items:baseline;gap:10px;padding:6px 9px;text-decoration:none;font-size:13px;line-height:1.5;border-radius:5px;color:#536169}.contents a span{font-size:11px;color:#8b959b;flex-shrink:0}.contents a:hover,.contents a.active{background:#e3e8e5;color:#184e60}.contents a.active{box-shadow:inset 3px 0 0 var(--blue)}.nav-footer{margin-top:24px;font-size:12px;color:var(--muted)}
main{margin-left:var(--nav);padding:56px clamp(28px,5vw,90px) 80px;max-width:1450px}.hero{max-width:1000px;margin:0 0 46px;padding-bottom:34px;border-bottom:1px solid var(--line)}.eyebrow{font-size:12px;font-weight:650;letter-spacing:.18em;color:var(--accent);margin-bottom:15px}.hero h1{font-size:clamp(30px,3.4vw,48px);line-height:1.25;letter-spacing:-.035em;margin:0 0 20px;font-weight:750}.hero .subtitle{font-size:19px;line-height:1.8;max-width:760px;color:#4f626c;margin:0 0 22px}.meta{display:flex;gap:10px;flex-wrap:wrap;align-items:center;font-size:12px;color:var(--muted)}.badge{border:1px solid #d8b6a7;border-radius:4px;padding:2px 8px;color:#8a4026;background:#fff5eb}.meta .dot{color:#afb4b4}.actions{margin-top:20px;display:flex;gap:12px;flex-wrap:wrap}.actions a,.actions button{font:inherit;font-size:13px;padding:7px 13px;border:1px solid #cbd4d4;border-radius:5px;color:var(--blue);background:#fff;text-decoration:none;cursor:pointer}.actions a:hover,.actions button:hover{background:#edf3f2}
.principles{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:26px 0 0}.principles div{border-top:2px solid #b4c5c7;padding:10px 4px 0}.principles b{font-size:15px;display:block}.principles small{font-size:12px;color:var(--muted);display:block;line-height:1.7;margin-top:5px}
article{max-width:1000px}article>p:first-child{font-size:20px;line-height:1.8}h2{font-size:27px;line-height:1.5;letter-spacing:-.02em;margin:64px 0 22px;padding-top:20px;border-top:1px solid var(--line);font-weight:720}h3{font-size:19px;margin:32px 0 14px;color:#294b57}p{margin:14px 0}strong{font-weight:680}ul,ol{padding-left:1.5em;margin:15px 0}li{padding-left:3px;margin:7px 0}li::marker{color:#7f969e}
.table-scroll{overflow-x:auto;border:1px solid var(--line);border-radius:7px;margin:22px 0;background:var(--card)}table{width:100%;border-collapse:collapse;font-size:14px;line-height:1.8;min-width:560px}th{background:#edf1ef;text-align:left;color:#274c59;font-size:13px;font-weight:650;padding:12px 14px;vertical-align:top}td{padding:13px 14px;border-top:1px solid #e5e7e4;vertical-align:top}tbody tr:nth-child(even){background:#fcfcfa}td:first-child{min-width:115px}code{font-family:ui-monospace,"SFMono-Regular",Consolas,"Noto Sans Mono CJK SC",monospace;font-size:.87em;background:#eef0ed;padding:2px 5px;border-radius:3px;overflow-wrap:anywhere}pre{background:#20333d;color:#e6efeb;border-radius:8px;padding:23px 25px;margin:24px 0;overflow-x:auto;font-size:13px;line-height:1.8;tab-size:2}pre code{background:none;color:inherit;padding:0;font-size:inherit;overflow-wrap:normal;white-space:pre}blockquote{margin:20px 0;border-left:3px solid var(--accent);padding:8px 20px;background:#f4eee6;color:#5b5148}footer{max-width:1000px;margin-top:70px;padding-top:22px;border-top:1px solid var(--line);color:var(--muted);font-size:12px}
@media(min-width:1700px){main{margin-left:max(var(--nav),calc((100vw - 1300px)/2))}}
@media(max-width:1000px){:root{--nav:230px}aside{padding:26px 14px}.contents a{font-size:12px}main{padding:40px 24px 60px}.hero h1{font-size:34px}.principles{gap:10px}}
@media(max-width:760px){aside{position:relative;width:auto;max-height:none;border-right:0;border-bottom:1px solid var(--line);padding:20px 22px 10px}.brand{font-size:25px}.nav-caption{margin-bottom:12px}.nav-footer{display:none}.contents nav{grid-template-columns:1fr 1fr}.contents a{font-size:12px}.contents summary{margin-bottom:8px}main{margin-left:0;padding:30px 20px 50px}.hero{margin-bottom:30px}.hero h1{font-size:32px}.hero .subtitle{font-size:17px}.principles{grid-template-columns:1fr}.principles div{padding-top:8px}.principles small{display:inline}.principles b{display:inline;margin-right:12px}h2{font-size:23px;margin-top:42px}h3{font-size:18px}body{font-size:15px}pre{padding:18px 16px;font-size:12px}article>p:first-child{font-size:18px}}
@media print{@page{size:A4;margin:18mm 16mm}html{scroll-behavior:auto}body{background:white;font-size:10pt;color:#111}aside,.read-progress,.actions,.skip{display:none!important}main{margin:0;max-width:none;padding:0}.hero{padding-bottom:15px;margin-bottom:20px}.hero h1{font-size:25pt}.hero .subtitle{font-size:12pt}.principles{gap:10px}h2{font-size:17pt;margin:28px 0 12px;padding-top:12px;break-after:avoid}h3{font-size:12pt;break-after:avoid}p,li{orphans:3;widows:3}.table-scroll{overflow:visible;border-radius:0;break-inside:auto}table{min-width:0;font-size:9pt}th,td{padding:7px}tr{break-inside:avoid}thead{display:table-header-group}pre{white-space:pre-wrap;overflow:visible;font-size:8pt;background:#f4f5f3;color:#111;border:1px solid #ddd;break-inside:auto}pre code{white-space:pre-wrap;overflow-wrap:anywhere}a{color:inherit}footer{margin-top:25px}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
</style>
</head>
<body>
<a class="skip" href="#content">跳到正文</a>
<div class="read-progress" aria-hidden="true"><div id="progress"></div></div>
<aside>
<a class="brand" href="#top">notifs<b>.</b></a>
<div class="nav-caption">团队通信基础设施 · 设计文档</div>
<details class="contents" open><summary>设计范围 · SECTION_COUNT 项</summary><nav aria-label="章节导航">NAV_CONTENT</nav></details>
<div class="nav-footer">架构概览<br>2026-11-09 · 可离线阅读<br>完整正文 · 无远程资源</div>
</aside>
<main id="top">
<header class="hero">
<div class="eyebrow">NOTIFS / SUBSCRIPTION HUB</div>
<h1>notifs · 架构设计</h1>
<p class="subtitle">程序事件、agent 消息和人的输入，共用一套可配置的路由与交付机制。</p>
<div class="meta"><span class="badge">单一通信内核</span><span>0.2 alpha</span><span class="dot">/</span><span>2026-11-09</span><span class="dot">/</span><span>SECTION_COUNT 项 · 目标、机制与边界</span></div>
<div class="actions"><a href="notifs.md">查看 Markdown 源文档</a><button type="button" id="print">打印 / 另存 PDF</button></div>

</header>
<article id="content">ARTICLE_CONTENT</article>
<footer>此页面由 notifs.md 生成。本文为架构提案。<br>生成方式：python3 tools/render-notifs-design.py</footer>
</main>
<script>
(() => {
  const links = [...document.querySelectorAll('nav a')];
  const headings = [...document.querySelectorAll('article h2')];
  const progress = document.getElementById('progress');
  let ticking = false;
  function update() {
    const max = document.documentElement.scrollHeight - innerHeight;
    progress.style.width = (max > 0 ? Math.min(100, scrollY / max * 100) : 100) + '%';
    let current = headings[0];
    for (const heading of headings) { if (heading.getBoundingClientRect().top <= 140) current = heading; else break; }
    for (const link of links) {
      const active = current && link.hash === '#' + current.id;
      link.classList.toggle('active', Boolean(active));
      if (active) link.setAttribute('aria-current', 'location'); else link.removeAttribute('aria-current');
    }
    ticking = false;
  }
  addEventListener('scroll', () => {if (!ticking) {requestAnimationFrame(update);ticking = true;}}, {passive:true});
  addEventListener('resize', update);
  document.getElementById('print').addEventListener('click', () => print());
  const contents = document.querySelector('.contents');
  if (matchMedia('(max-width:760px)').matches) contents.open = false;
  update();
})();
</script>
</body>
</html>
'''.replace('NAV_CONTENT', ''.join(nav)).replace('ARTICLE_CONTENT', str(soup)).replace('SECTION_COUNT', str(chapter))
TARGET.write_text(html, encoding='utf-8')
print(f'Rendered {TARGET}: {chapter} chapters, {len(html.encode("utf-8")):,} bytes')
