import asyncio
import json
import subprocess
import time
import urllib.request
import websockets
import sys

CHROME_PATH = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
PORT = 9223

async def send_cmd(ws, msg_id, method, params=None):
    payload = {"id": msg_id, "method": method}
    if params:
        payload["params"] = params
    await ws.send(json.dumps(payload))
    while True:
        resp = await ws.recv()
        data = json.loads(resp)
        if data.get("id") == msg_id:
            return data

async def evaluate_js(ws, msg_id, expr):
    res = await send_cmd(ws, msg_id, "Runtime.evaluate", {
        "expression": expr,
        "awaitPromise": True,
        "returnByValue": True
    })
    return res.get("result", {}).get("result", {}).get("value")

async def run_audit():
    # Fetch axe-core script
    print("Fetching axe-core 4.9.1...")
    with urllib.request.urlopen("https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.9.1/axe.min.js") as r:
        axe_script = r.read().decode("utf-8")
    print(f"Axe-core loaded ({len(axe_script)} bytes)")

    chrome_proc = subprocess.Popen([
        CHROME_PATH,
        f"--remote-debugging-port={PORT}",
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        "--user-data-dir=C:\\temp\\chrome_a11y_profile"
    ])
    print(f"Launched headless Chrome on port {PORT}")
    time.sleep(2)

    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/list") as r:
            targets = json.loads(r.read().decode())
        ws_url = targets[0]["webSocketDebuggerUrl"]
        print("Connected to target:", ws_url)

        async with websockets.connect(ws_url, max_size=10_000_000) as ws:
            msg_id = 1

            # Enable Page and Runtime
            await send_cmd(ws, msg_id, "Page.enable"); msg_id += 1
            await send_cmd(ws, msg_id, "Runtime.enable"); msg_id += 1
            await send_cmd(ws, msg_id, "Emulation.setDeviceMetricsOverride", {
                "width": 1440,
                "height": 900,
                "deviceScaleFactor": 1,
                "mobile": False
            }); msg_id += 1

            audit_results = {}

            # Helper to run axe on current page
            async def run_axe_on_page(page_name):
                nonlocal msg_id
                # Inject axe if not already present
                has_axe = await evaluate_js(ws, msg_id, "typeof window.axe !== 'undefined'")
                msg_id += 1
                if not has_axe:
                    await evaluate_js(ws, msg_id, axe_script)
                    msg_id += 1

                # Run axe wrapped in an immediately invoked async function
                axe_eval = """
                (() => {
                    return new Promise((resolve) => {
                        try {
                            axe.run(document, {
                                runOnly: {
                                    type: 'tag',
                                    values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
                                }
                            }, (err, results) => {
                                if (err) resolve({ error: err.message, violations: [] });
                                else resolve({
                                    violations: (results.violations || []).map(v => ({
                                        id: v.id,
                                        impact: v.impact,
                                        description: v.description,
                                        help: v.help,
                                        nodesCount: v.nodes.length,
                                        targets: v.nodes.slice(0, 3).map(n => n.target.join(' ')),
                                        failureSummary: v.nodes[0] ? v.nodes[0].failureSummary : ''
                                    })),
                                    passesCount: (results.passes || []).length,
                                    incompleteCount: (results.incomplete || []).length
                                });
                            });
                        } catch (e) {
                            resolve({ error: e.message, violations: [] });
                        }
                    });
                })()
                """
                res = await evaluate_js(ws, msg_id, axe_eval)
                msg_id += 1
                return res or {}

            pages = [
                ("Heat Map View", "http://localhost:5173/new_delhi/map"),
                ("Heat Drivers View", "http://localhost:5173/new_delhi/drivers"),
                ("Scenarios View", "http://localhost:5173/new_delhi/scenarios")
            ]

            for name, url in pages:
                print(f"\n=========================================")
                print(f"Auditing Page: {name} ({url})")
                print(f"=========================================")
                await send_cmd(ws, msg_id, "Page.navigate", {"url": url}); msg_id += 1
                time.sleep(2.5) # Wait for page load and API fetch

                res = await run_axe_on_page(name)
                violations = res.get("violations", []) if res else []
                passes = res.get("passesCount", 0) if res else 0
                print(f"Axe Checks Passed: {passes}")
                print(f"Axe Violations: {len(violations)}")
                if violations:
                    for v in violations:
                        print(f"  [VIOLATION] {v['id']} ({v['impact']}): {v['help']}")
                        print(f"    Targets: {v['targets']}")
                        print(f"    Failure: {v['failureSummary'][:100]}...")
                audit_results[name] = {"violations": violations, "passes": passes}

            # Test 4: City Combobox Keyboard Navigation
            print(f"\n=========================================")
            print("Auditing Interactive Component: CityCombobox")
            print(f"=========================================")
            combobox_check = await evaluate_js(ws, msg_id, """
            (() => {
                const trigger = document.querySelector('.city-combobox-trigger');
                if (!trigger) return { error: 'Trigger not found' };
                const role = trigger.getAttribute('role');
                const ariaHasPopup = trigger.getAttribute('aria-haspopup');
                const ariaExpanded = trigger.getAttribute('aria-expanded');
                const ariaControls = trigger.getAttribute('aria-controls');
                const ariaLabel = trigger.getAttribute('aria-label');
                return {
                    role,
                    ariaHasPopup,
                    ariaExpanded,
                    ariaControls,
                    ariaLabel
                };
            })()
            """); msg_id += 1
            print("Combobox Trigger Attributes:", json.dumps(combobox_check, indent=2))

            # Test 5: Sliders in ScenarioView
            print(f"\n=========================================")
            print("Auditing Interactive Component: Scenario Sliders & Inputs")
            print(f"=========================================")
            await send_cmd(ws, msg_id, "Page.navigate", {"url": "http://localhost:5173/new_delhi/scenarios"}); msg_id += 1
            time.sleep(2)
            sliders_check = await evaluate_js(ws, msg_id, """
            (() => {
                const sliders = Array.from(document.querySelectorAll('.range-slider'));
                return sliders.map(s => ({
                    id: s.id,
                    ariaLabel: s.getAttribute('aria-label'),
                    ariaValueMin: s.getAttribute('aria-valuemin'),
                    ariaValueMax: s.getAttribute('aria-valuemax'),
                    ariaValueNow: s.getAttribute('aria-valuenow'),
                    ariaValueText: s.getAttribute('aria-valuetext')
                }));
            })()
            """); msg_id += 1
            print(f"Found {len(sliders_check)} Sliders:")
            for s in sliders_check:
                print(f"  Slider {s['id']}: aria-label='{s['ariaLabel']}', val={s['ariaValueNow']}, text='{s['ariaValueText']}'")

            # Test 6: Modals Focus Trap and ARIA
            print(f"\n=========================================")
            print("Auditing Interactive Component: Modals & Focus Trap")
            print(f"=========================================")
            # Open About modal by clicking info button
            await evaluate_js(ws, msg_id, """
            (() => {
                const btn = document.querySelector('.nav-tool-btn.icon-only[aria-label*="About"]');
                if (btn) btn.click();
            })()
            """); msg_id += 1
            time.sleep(0.5)

            modal_check = await evaluate_js(ws, msg_id, """
            (() => {
                const modal = document.querySelector('.modal-card[role="dialog"]');
                if (!modal) return { found: false };
                const ariaModal = modal.getAttribute('aria-modal');
                const ariaLabelledby = modal.getAttribute('aria-labelledby');
                const heading = document.getElementById(ariaLabelledby);
                const activeElTag = document.activeElement ? document.activeElement.tagName : null;
                const activeElLabel = document.activeElement ? document.activeElement.getAttribute('aria-label') : null;
                return {
                    found: true,
                    role: modal.getAttribute('role'),
                    ariaModal,
                    ariaLabelledby,
                    headingText: heading ? heading.textContent : null,
                    initialFocusedElement: `${activeElTag} (aria-label: ${activeElLabel})`
                };
            })()
            """); msg_id += 1
            print("About Modal ARIA Check:", json.dumps(modal_check, indent=2))

            # Run Axe on open About Modal
            axe_modal = await run_axe_on_page("About Modal")
            print(f"About Modal Axe Violations: {len(axe_modal.get('violations', []))}")
            if axe_modal.get('violations'):
                for v in axe_modal['violations']:
                    print(f"  [VIOLATION] {v['id']}: {v['help']}")

            # Close modal with Escape key
            await send_cmd(ws, msg_id, "Input.dispatchKeyEvent", {
                "type": "rawKeyDown",
                "key": "Escape",
                "code": "Escape",
                "windowsVirtualKeyCode": 27
            }); msg_id += 1
            await send_cmd(ws, msg_id, "Input.dispatchKeyEvent", {
                "type": "keyUp",
                "key": "Escape",
                "code": "Escape",
                "windowsVirtualKeyCode": 27
            }); msg_id += 1
            time.sleep(0.5)

            is_closed = await evaluate_js(ws, msg_id, "document.querySelector('.modal-card') === null"); msg_id += 1
            print(f"Modal dismissed on Escape: {is_closed}")

            # Test 7: Multi-channel indicators on Heatmap
            print(f"\n=========================================")
            print("Auditing Multi-Channel Heatmap Classification")
            print(f"=========================================")
            await send_cmd(ws, msg_id, "Page.navigate", {"url": "http://localhost:5173/new_delhi/map"}); msg_id += 1
            await evaluate_js(ws, msg_id, """
            new Promise((resolve) => {
                const start = Date.now();
                const interval = setInterval(() => {
                    if (document.querySelector('.tier-cell') || Date.now() - start > 5000) {
                        clearInterval(interval);
                        resolve(true);
                    }
                }, 100);
            })
            """); msg_id += 1

            multichannel_check = await evaluate_js(ws, msg_id, """
            (() => {
                const tierCells = Array.from(document.querySelectorAll('.tier-cell'));
                return tierCells.map(c => {
                    const name = c.querySelector('.tier-name')?.textContent;
                    const delta = c.querySelector('.tier-delta')?.textContent;
                    const glyph = c.querySelector('.tier-glyph')?.textContent;
                    const desc = c.querySelector('.tier-desc')?.textContent;
                    return { name, delta, glyph, desc };
                });
            })()
            """); msg_id += 1
            print("Legend Multi-Channel Tiers:", json.dumps(multichannel_check, indent=2))

            # Test 8: Reduced motion CSS rules
            print(f"\n=========================================")
            print("Auditing prefers-reduced-motion Support")
            print(f"=========================================")
            reduced_motion_check = await evaluate_js(ws, msg_id, """
            (() => {
                const rules = [];
                for (const sheet of document.styleSheets) {
                    try {
                        for (const rule of sheet.cssRules) {
                            if (rule.media && rule.media.mediaText.includes('prefers-reduced-motion')) {
                                rules.push(rule.cssText);
                            }
                        }
                    } catch (e) {}
                }
                return rules;
            })()
            """); msg_id += 1
            print(f"Found {len(reduced_motion_check)} prefers-reduced-motion media query rules.")

    finally:
        chrome_proc.terminate()
        print("\nTerminated Chrome process.")

if __name__ == "__main__":
    asyncio.run(run_audit())
