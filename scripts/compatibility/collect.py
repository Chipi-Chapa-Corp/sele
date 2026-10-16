#!/usr/bin/env python3
"""Collect a NEW candidate snapshot; never overwrite the reviewed report by default.

Requires Python 3, requests and beautifulsoup4. No model inference or GUI is used.
The installed codex executable is invoked only for version, schema export, and
feature listing. No app-server session is started or user config modified.
"""
import argparse
import concurrent.futures
import hashlib
import json
import re
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlsplit, urlunsplit

import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / 'docs/compatibility'
SEED = 'https://learn.chatgpt.com/codex/features'


def normalize(url):
    p = urlsplit(url)
    return urlunsplit((p.scheme, p.netloc, p.path.rstrip('/'), '', ''))


def sha(value):
    return hashlib.sha256(value.encode()).hexdigest()


def extract(url, fetched_at):
    try:
        response = requests.get(url, timeout=45)
        response.raise_for_status()
        soup = BeautifulSoup(response.text, 'html.parser')
        is_timeline = urlsplit(url).path == '/codex/changelog'
        is_release = urlsplit(url).netloc == 'github.com'
        article = (soup.find('main') if is_timeline else soup.select_one('.markdown-body') if is_release else soup.find('article')) or soup.find('main')
        if article is None:
            raise ValueError('No article or main content; refusing to count an empty fetch')
        title = ('Codex CLI ' + url.rsplit('rust-v', 1)[1] + ' release') if is_release else (article.find('h1') or soup.find('h1') or soup.title).get_text(' ', strip=True)
        headings = [h.get_text(' ', strip=True) for h in article.select('h2,h3,h4')]
        new = None if is_timeline else article.find('h2', string='New Features')
        bullets = [li.get_text(' ', strip=True) for li in new.find_next_sibling('ul').find_all('li', recursive=False)] if new else []
        history = []
        if is_timeline:
            for entry in article.select('article'):
                entry_title = entry.find_previous(['h1','h2','h3','h4']).get_text(' ',strip=True)
                features = []
                for section in entry.select('h2,h3,h4'):
                    if section.get_text(' ',strip=True).lower() == 'new features':
                        ul = section.find_next_sibling('ul')
                        if ul:
                            features.extend(li.get_text(' ',strip=True) for li in ul.find_all('li',recursive=False))
                for raw in features or ['announcement']:
                    history.append({'key':'timeline-' + sha(entry_title + '\0' + raw)[:20],
                                    'source':url,'date_or_section':entry_title,
                                    'source_entry_sha256':sha(raw)})
            if not history:
                raise ValueError('No changelog entries found; inspect changed documentation layout')
        return {'url': url, 'resolved_url': response.url, 'title': title,
                'fetch_status': 'HTTP 200', 'fetched_at': fetched_at,
                'sha256': sha(' '.join(article.get_text(' ', strip=True).split())),
                'section_count': len(headings)}, headings, bullets, history
    except Exception as error:
        return {'url': url, 'title': 'Retrieval failed', 'fetch_status': str(error),
                'fetched_at': fetched_at, 'sha256': ''}, [], [], []


def run(*args):
    return subprocess.check_output(args, cwd=ROOT, text=True, timeout=60)


def collect(codex, previous, fetched_at):
    version = run(codex, '--version').strip().removeprefix('codex-cli ')
    release_url = f'https://github.com/openai/codex/releases/tag/rust-v{version}'
    response = requests.get(SEED, timeout=45)
    response.raise_for_status()
    soup = BeautifulSoup(response.text, 'html.parser')
    urls = {normalize(urljoin(SEED, a['href'])) for a in soup.select('a[href]')
            if a['href'].startswith('/codex')}
    if len(urls) < 30:
        raise ValueError('Navigation extraction unexpectedly small; inspect changed documentation layout')
    # Keep previously consulted/blocked historical sources in the candidate scope ledger.
    urls.update(s['url'] for s in previous['sources'] if not urlsplit(s['url']).path.startswith('/codex'))
    urls.add(release_url)
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(lambda u: extract(u, fetched_at), sorted(urls)))
    sources = [r[0] for r in results]
    lookup = {s['url']: (headings, bullets, history) for s, headings, bullets, history in results}
    old_updates = {u['key']: u for u in previous['updates']}
    updates = []
    digest = 'https://learn.chatgpt.com/codex/whats-new'
    section = ''
    for heading in lookup[digest][0]:
        if re.match(r'^(January|February|March|April|May|June|July|August|September|October|November|December)\b.*\b\d{4}$', heading):
            section = heading
            continue
        key = sha(digest + '\0' + heading)[:20]
        updates.append({'key': key, 'source': digest, 'date_or_section': section,
                        'candidate': old_updates.get(key, {}).get('candidate', 'REVIEW NEW UPDATE: ' + heading),
                        'heading_sha256': sha(heading)})
    if not lookup[release_url][1]:
        raise ValueError('No CLI release New Features section; do not silently drop the current CLI release')
    for i, bullet in enumerate(lookup[release_url][1], 1):
        key = f'cli-{version}-new-{i}'
        old = old_updates.get(key, {})
        # CLI version alone is not enough: require the same entry text hash.
        unchanged = old.get('source_entry_sha256') == sha(bullet)
        updates.append({'key': key, 'source': release_url,
                        'date_or_section': f'Codex CLI {version} / New Features',
                        'candidate': old.get('candidate') if unchanged else 'REVIEW NEW CLI ENTRY #' + str(i),
                        'source_entry_sha256': sha(bullet)})
    for item in lookup['https://learn.chatgpt.com/codex/changelog'][2]:
        old = old_updates.get(item['key'], {})
        updates.append({**item,'candidate':old.get('candidate','REVIEW NEW CHANGELOG ENTRY')})
    protocol = {}
    provenance = {}
    with tempfile.TemporaryDirectory(prefix='sele-parity-schema-') as temp:
        run(codex, 'app-server', 'generate-json-schema', '--experimental', '--out', temp)
        for kind in ['ClientRequest', 'ServerRequest', 'ClientNotification', 'ServerNotification']:
            raw = Path(temp, kind + '.json').read_text()
            data = json.loads(raw)
            protocol[kind] = sorted({v['properties']['method']['enum'][0] for v in data.get('oneOf', [])})
            provenance[kind] = sha(raw)
        inputs = json.loads(Path(temp, 'ClientRequest.json').read_text())['definitions']['UserInput']['oneOf']
        items = json.loads(Path(temp, 'ServerNotification.json').read_text())['definitions']['ThreadItem']['oneOf']
    raw_flags = run(codex, 'features', 'list')
    flags = []
    for line in raw_flags.splitlines():
        match = re.match(r'^(\S+)\s+(.+?)\s+(true|false)$', line)
        if not match:
            raise ValueError('Unexpected feature list format: ' + line)
        name, stage, enabled = match.groups()
        flags.append({'name': name, 'stage': stage, 'enabled_in_inspected_cli': enabled})
    return {'as_of': fetched_at, 'codex_version': version, 'sources': sources,
            'updates': updates, 'protocol': protocol, 'protocol_schema_sha256': provenance,
            'flags': flags, 'flags_output_sha256': sha(raw_flags),
            'input_types': sorted(x['properties']['type']['enum'][0] for x in inputs),
            'thread_item_types': sorted(x['properties']['type']['enum'][0] for x in items)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, default=ROOT / 'tmp/parity-refresh')
    parser.add_argument('--codex', default='codex')
    args = parser.parse_args()
    previous = json.loads((BASE / 'snapshot.json').read_text())
    current = collect(args.codex, previous, datetime.now(timezone.utc).date().isoformat())
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / 'snapshot.json').write_text(json.dumps(current, ensure_ascii=False, indent=2) + '\n')
    old = {s['url']:s for s in previous['sources']}
    changed = [s['url'] for s in current['sources'] if s['sha256'] != old.get(s['url'], {}).get('sha256')]
    old_keys = {u['key'] for u in previous['updates']}
    report = {'new_sources': sorted(set(s['url'] for s in current['sources']) - set(old)),
              'removed_sources': sorted(set(old) - set(s['url'] for s in current['sources'])),
              'changed_sources': changed,
              'new_update_keys': [u['key'] for u in current['updates'] if u['key'] not in old_keys],
              'removed_update_keys': sorted(old_keys - {u['key'] for u in current['updates']}),
              'failed_fetches': [s['url'] for s in current['sources'] if s['fetch_status'] != 'HTTP 200'],
              'protocol_changed': current['protocol'] != previous['protocol'],
              'flags_changed': current['flags'] != previous['flags']}
    (args.out / 'changes.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'candidate_directory': str(args.out), **report}, indent=2))


if __name__ == '__main__':
    main()
