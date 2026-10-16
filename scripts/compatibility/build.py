#!/usr/bin/env python3
"""Build Sele's parity audit without network access or model calls.

python scripts/compatibility/build.py           # regenerate derived reports
python scripts/compatibility/build.py --check   # validate and compare, no writes

Refresh source inputs separately with collect.py. features.json is human-reviewed;
discovering a capability never automatically promotes it to Implemented.
"""
import argparse
import collections
import csv
import hashlib
import html
import io
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / 'docs/compatibility'
STATUSES = ['Implemented', 'Partial', 'Runtime', 'Missing', 'Unverified']


def read(name):
    return json.loads((BASE / name).read_text())


def json_text(value):
    return json.dumps(value, ensure_ascii=False, indent=2) + '\n'


def csv_text(rows, fields):
    out = io.StringIO(newline='')
    writer = csv.DictWriter(out, fieldnames=fields, lineterminator='\n')
    writer.writeheader()
    writer.writerows(rows)
    return out.getvalue()


def source_files():
    return sorted(p for p in (ROOT / 'src/main/providers/codex').glob('*.ts')
                  if not p.name.endswith('.test.ts'))


def references(value, files):
    # Literal references are evidence of wiring, not proof of a working feature.
    result = []
    for p in files:
        for line, text in enumerate(p.read_text().splitlines(), 1):
            if re.search(r"(['\"])" + re.escape(value) + r'\1', text):
                result.append({'path': str(p.relative_to(ROOT)), 'line': line})
    return result


def resolve_evidence(e):
    p = ROOT / e['path']
    assert p.is_file(), f'Missing evidence: {p}'
    text = p.read_text()
    assert e['needle'] in text, f'Evidence anchor changed: {e}'
    return {'path': e['path'], 'line': text[:text.index(e['needle'])].count('\n') + 1,
            'anchor': e['needle']}


def markdown_link(e):
    return f"[{Path(e['path']).name}:{e['line']}](../../{e['path']}#L{e['line']})"


def cell(text):
    return str(text).replace('|', '\\|').replace('\n', ' ')


def build():
    catalog, snapshot, decisions = read('features.json'), read('snapshot.json'), read('coverage-decisions.json')
    rows = catalog['features']
    ids = {r['id'] for r in rows}
    assert len(ids) == len(rows), 'Duplicate feature IDs'
    source_by_url = {s['url']: s for s in snapshot['sources']}
    for row in rows:
        assert row['sele_status'] in STATUSES, row['id']
        assert row['priority'] in ['P0', 'P1', 'P2'], row['id']
        assert row['sources'] and row['assessment'] and row['evidence'], row['id']
        assert all(u in source_by_url for u in row['sources']), f"Unknown source: {row['id']}"
    assert set(decisions) == set(source_by_url), 'Source discovery changed; classify every source'
    resolved = [{**r, 'evidence': [resolve_evidence(e) for e in r['evidence']]} for r in rows]

    coverage = []
    for s in snapshot['sources']:
        d = decisions[s['url']]
        assert d['disposition'] in ['Mapped', 'Reference', 'Excluded', 'Unavailable'], s['url']
        assert d['reason'], s['url']
        assert d['reviewed_sha256'] == s.get('sha256', ''), f"Source content changed; review {s['url']}"
        assert d['reviewed_fetch_status'] == s['fetch_status'], f"Source retrieval changed; review {s['url']}"
        mapped = [r['id'] for r in rows if s['url'] in r['sources']]
        mapped += d.get('feature_ids', [])
        mapped = sorted(set(mapped))
        assert set(mapped) <= ids, s['url']
        assert d['disposition'] != 'Mapped' or mapped, f"Unmapped source: {s['url']}"
        coverage.append({'url': s['url'], 'title': s['title'], 'disposition': d['disposition'],
                         'feature_ids': '; '.join(mapped), 'reason': d['reason'],
                         'fetched_at': s['fetched_at'], 'fetch_status': s['fetch_status'],
                         'sha256': s.get('sha256', '')})

    files = source_files()
    protocol = []
    for kind, methods in snapshot['protocol'].items():
        for method in methods:
            refs = references(method, files)
            # Requests require dispatch, whereas notifications may be intentionally ignored.
            status = 'Literal reference' if refs else 'No literal reference'
            note = 'Static reference only; assess behavior in the feature table.'
            if kind == 'ServerRequest':
                if method == 'mcpServer/elicitation/request':
                    status, note = 'Partial handler', 'Only ordinary empty-schema browser permission prompts.'
                elif method in ['item/tool/requestUserInput', 'item/commandExecution/requestApproval',
                                 'item/fileChange/requestApproval']:
                    status, note = 'Handler present', 'Explicit dispatch in CodexProviderAdapter.'
                else:
                    status, note = 'No handler', 'Falls through to Unsupported server request (-32601).'
            protocol.append({'kind': kind, 'method': method, 'sele_static_result': status,
                             'references': '; '.join(f"{e['path']}:{e['line']}" for e in refs), 'note': note})

    flags = []
    for f in snapshot['flags']:
        refs = references(f['name'], files)
        flags.append({**f, 'sele_static_result': 'Dynamic feature editor; runtime behavior unverified',
                      'literal_references': '; '.join(f"{e['path']}:{e['line']}" for e in refs)})

    flat = [{**{k: r[k] for k in ['id','category','feature','baseline_surface','sele_status','assessment','priority','verification']},
             'sources': '; '.join(r['sources']),
             'evidence': '; '.join(f"{e['path']}:{e['line']}" for e in r['evidence'])} for r in resolved]
    counts = collections.Counter(r['sele_status'] for r in rows)
    lines = ['# ChatGPT desktop + Codex app/CLI compatibility with Sele', '',
             f"Audit: **{catalog['as_of']}**. Sele **{catalog['sele_version']}**, commit `{catalog['sele_commit']}`; installed Codex **{catalog['codex_version']}**.", '',
             catalog['scope'], '',
             '**Use [the searchable table](table.html), [CSV](features.csv), or [reviewed JSON](features.json).**', '',
             '## Reading the ratings', '',
             '| Rating | Meaning | Rows |', '|---|---|---:|']
    definitions = {
        'Implemented': 'Explicit Sele implementation found. Static inspection, not end-to-end certification.',
        'Partial': 'A useful subset exists; the assessment names the missing behavior.',
        'Runtime': 'Possible through installed Codex/tools/skills. Requires compatible runtime, dependencies, credentials, and permissions; not verified in this audit.',
        'Missing': 'No native implementation found in the inspected Sele checkout. A shell/browser workaround is not counted as app parity.',
        'Unverified': 'Available evidence cannot establish support; do not treat as compatible.'}
    for s in STATUSES:
        lines.append(f'| {s} | {definitions[s]} | {counts[s]} |')
    lines += ['', f'**{len(rows)} feature rows.** These are unweighted inventory counts, not a parity percentage. Runtime and Unverified are not supported-feature claims.', '',
              '## Coverage and limits', '',
              'The inventory uses the current official desktop feature/configuration/developer documentation, every entry in the published desktop changelog, the dated desktop update digest, the version-pinned CLI release, Classic desktop release notes, and the installed CLI protocol/feature exports. The current docs describe the former Codex app as the ChatGPT desktop app; Classic is kept separate.', '',
              f"The source index contains **{len(coverage)} documents**, each explicitly mapped, treated as reference, excluded, or marked unavailable. [Source ledger](coverage.csv) records every discovered navigation page, its disposition, and feature IDs. [Dated-update ledger](updates.csv) maps every extracted update heading or explicitly excludes it.", '',
              f"Mechanical appendix: **{sum(len(m) for m in snapshot['protocol'].values())} protocol methods/events**, **{len(flags)} feature flags**, **{len(snapshot['input_types'])} user-input variants**, and **{len(snapshot['thread_item_types'])} transcript-item variants** from the installed Codex export. See [protocol.csv](protocol.csv), [flags.csv](flags.csv), [input-types.csv](input-types.csv), and [transcript-items.csv](transcript-items.csv). [Tool families](tool-families.csv) separately explains execution versus display support. These are protocol/configuration coverage, not a complete list of model-callable tools.", '',
              '“Full” is bounded by this dated public corpus and the feature granularity below. It cannot prove coverage of undocumented/private flags, experiments, every OS/plan rollout, every third-party plugin, or every operation exposed by a changing connector catalog. Page mapping is a topic-level crosswalk, not proof that every sentence/subheading has a distinct feature row. Historical changelogs are not treated as proof that a feature is still available.', '',
              'Desktop-app and CLI differences are identified in the Surface column. Mobile, standalone web-only features, IDE extension UX, cloud-service administration, enterprise provisioning/compliance, API/SDK development, pricing promotions, model retunes, bug fixes, and documentation-only changes are excluded. Desktop entry points to hosted services remain listed. Hosted service execution is conditional, not a native Sele implementation.', '',
              'Feature audit method: static code inspection and schema export. No model inference, Sele launch, sign-in changes, or connector writes. The generated HTML report was separately rendered in an isolated Electron fixture on a private display; search, filters, reset, row counts, and narrow layout passed. This verifies the report UI, not feature execution. Existing application tests are not newly executed certification. Negative findings were checked against the provider adapter, shared API contract, app lifecycle, settings, composer, browser documentation, and workspace components. Links identify the implementation or relevant control surface; absence is a scoped code-search conclusion.', '',
              '## Most consequential gaps', '',
              '1. **Protocol completeness:** general MCP forms/auth challenges, permission-scope requests, client-executed tools, user verification/attestation, and external-token refresh. Unsupported server requests are explicitly rejected by Sele; installed tools can therefore fail despite appearing in a catalog.',
              '2. **Daily workflows:** plan mode, native review mode, archive/delete/full-history search, plugin installation/OAuth, memory controls, and goal lifecycle controls.',
              '3. **Multimodal work:** dictation/live voice, native appshots, office/PDF review and annotation, and browser uploads/downloads.',
              '4. **Background work:** scheduling/event triggers, OS notifications, worktree setup/handoff, remote pairing, and hosted Work coordination.', '',
              'P0 marks a transport/interaction blocker; P1 marks a common workflow gap; P2 is a general comparison item. Priorities are audit recommendations, not an implementation commitment.', '']
    for category in dict.fromkeys(r['category'] for r in rows):
        lines += ['## ' + category, '', '| ID | Feature | Surface | Sele | Assessment / gap | Evidence | Source |', '|---|---|---|---|---|---|---|']
        for r in resolved:
            if r['category'] != category:
                continue
            ev = ', '.join(markdown_link(e) for e in r['evidence'])
            sources = ', '.join(f'[docs {i+1}]({u})' for i,u in enumerate(r['sources']))
            lines.append('| ' + ' | '.join(cell(x) for x in [r['id'],r['feature'],r['baseline_surface'],r['sele_status'],r['assessment'],ev,sources]) + ' |')
        lines.append('')
    lines += ['## Rebuild and extend the audit', '',
              'See [the maintenance guide](MAINTENANCE.md). The reviewed catalog is the source of truth; Markdown, CSV, HTML, and protocol reference scans are deterministic outputs. Refreshing sources never automatically labels a capability Implemented.', '']

    updates = read('update-decisions.json')
    expected_updates = {u['key'] for u in snapshot['updates']}
    assert set(updates) == expected_updates, 'Update discovery changed; classify every update'
    update_rows = []
    for u in snapshot['updates']:
        d = updates[u['key']]
        assert d['disposition'] in ['Mapped', 'Excluded', 'Reference'] and d['reason']
        assert set(d.get('feature_ids', [])) <= ids
        assert d['disposition'] != 'Mapped' or d.get('feature_ids')
        update_rows.append({'source': u['source'], 'date_or_section': u['date_or_section'],
                            'candidate': u['candidate'], 'disposition': d['disposition'],
                            'feature_ids': '; '.join(d.get('feature_ids',[])), 'reason': d['reason']})

    input_rows = []
    for name in snapshot['input_types']:
        status = 'Implemented' if name in ['text','localImage','skill'] else 'Partial' if name in ['mention','image'] else 'Missing'
        note = 'Structured input supported in createUserInput.' if status=='Implemented' else 'App mention is composed as prompt context; no general structured mention transport.' if name=='mention' else 'Image input is sent as localImage; remote image items can be read from history.' if name=='image' else 'No audio/localAudio input creation in Sele.'
        input_rows.append({'type':name,'sele_status':status,'note':note})

    item_rows = []
    for name in snapshot['thread_item_types']:
        refs = references(name, files)
        item_rows.append({'type':name,'sele_static_result':'Literal reference' if refs else 'No literal reference',
                          'references':'; '.join(f"{e['path']}:{e['line']}" for e in refs),
                          'note':'Reference scan only: not proof of complete rendering, deltas, metadata, or live/history consistency.'})
    tools = read('tool-families.json')
    by_id = {r['id']:r for r in rows}
    tool_rows = []
    for tool in tools:
        row = by_id[tool['feature_id']]
        tool_rows.append({**tool,'sele_feature_rating':row['sele_status'],
                          'source':'; '.join(row['sources'])})

    outputs = {'README.md': '\n'.join(lines),
               'features.csv': csv_text(flat, list(flat[0])),
               'coverage.csv': csv_text(coverage, list(coverage[0])),
               'updates.csv': csv_text(update_rows, list(update_rows[0])),
               'protocol.csv': csv_text(protocol, list(protocol[0])),
               'flags.csv': csv_text(flags, list(flags[0])),
               'input-types.csv': csv_text(input_rows,list(input_rows[0])),
               'transcript-items.csv':csv_text(item_rows,list(item_rows[0])),
               'tool-families.csv':csv_text(tool_rows,list(tool_rows[0]))}
    template = (ROOT / 'scripts/compatibility/table-template.html').read_text()
    payload = json.dumps({'as_of':catalog['as_of'],'sele_version':catalog['sele_version'],
                          'codex_version':catalog['codex_version'],'features':flat},ensure_ascii=False).replace('<','\\u003c')
    outputs['table.html'] = template.replace('"__AUDIT_DATA__"', payload)
    return outputs, {'features':len(rows),'counts':dict(counts),'sources':len(coverage),'updates':len(updates),'protocol':len(protocol),'flags':len(flags)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    outputs, summary = build()
    changed = []
    for name, content in outputs.items():
        p = BASE / name
        if not p.exists() or p.read_text() != content:
            changed.append(name)
            if not args.check:
                p.write_text(content)
    print(json.dumps({**summary,'changed':changed},indent=2))
    if args.check and changed:
        raise SystemExit('Derived audit files are stale; run build.py')


if __name__ == '__main__':
    main()
