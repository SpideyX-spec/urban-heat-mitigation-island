import asyncio
import json
import subprocess
import time
import urllib.request
import websockets

CHROME_PATH = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
PORT = 9224

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

async def run_full_audit():
    chrome_proc = subprocess.Popen([
        CHROME_PATH,
        f"--remote-debugging-port={PORT}",
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        "--user-data-dir=C:\\temp\\chrome_prod_profile"
    ])
    print(f"Launched Chrome on port {PORT}")
    time.sleep(2)

    console_errors = []
    network_errors = []

    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/list") as r:
            targets = json.loads(r.read().decode())
        ws_url = targets[0]["webSocketDebuggerUrl"]
        print("Connected to DevTools:", ws_url)

        async with websockets.connect(ws_url, max_size=10_000_000) as ws:
            msg_id = 1

            # Enable events
            await send_cmd(ws, msg_id, "Page.enable"); msg_id += 1
            await send_cmd(ws, msg_id, "Runtime.enable"); msg_id += 1
            await send_cmd(ws, msg_id, "Network.enable"); msg_id += 1
            await send_cmd(ws, msg_id, "Emulation.setDeviceMetricsOverride", {
                "width": 1440,
                "height": 900,
                "deviceScaleFactor": 1,
                "mobile": False
            }); msg_id += 1

            # Event listener loop helper
            async def drain_events():
                while True:
                    try:
                        resp = await asyncio.wait_for(ws.recv(), timeout=0.1)
                        evt = json.loads(resp)
                        method = evt.get("method")
                        if method == "Runtime.exceptionThrown":
                            console_errors.append(evt["params"])
                        elif method == "Runtime.consoleAPICalled":
                            if evt["params"]["type"] == "error":
                                console_errors.append(evt["params"])
                        elif method == "Network.responseReceived":
                            status = evt["params"]["response"]["status"]
                            url = evt["params"]["response"]["url"]
                            if status >= 400 and not url.endswith("/favicon.ico"):
                                network_errors.append({"url": url, "status": status})
                    except asyncio.TimeoutError:
                        break

            # 1. Test Navigation Routes & Redirects
            print("\n--- 1. Testing Navigation Routes & Redirects ---")
            await send_cmd(ws, msg_id, "Page.navigate", {"url": "http://localhost:5173/"}); msg_id += 1
            time.sleep(2.5)
            await drain_events()
            current_url = await evaluate_js(ws, msg_id, "window.location.pathname"); msg_id += 1
            print(f"Root '/' redirect target: {current_url}")
            assert "new_delhi" in current_url and "map" in current_url, f"Expected redirect to /new_delhi/map, got {current_url}"

            # Verify page title & metadata
            meta_check = await evaluate_js(ws, msg_id, """
            (() => ({
                title: document.title,
                favicon: document.querySelector('link[rel="icon"]')?.href,
                themeColor: document.querySelector('meta[name="theme-color"]')?.content
            }))()
            """); msg_id += 1
            print("Page Metadata:", json.dumps(meta_check, indent=2))
            assert "Urban Heat Mitigation" in meta_check["title"], "Page title missing Urban Heat Mitigation"

            # 2. Test City Switching
            print("\n--- 2. Testing City Switching ---")
            await evaluate_js(ws, msg_id, """
            (() => {
                const trigger = document.querySelector('.city-combobox-trigger');
                if (trigger) trigger.click();
            })()
            """); msg_id += 1
            time.sleep(0.5)

            await evaluate_js(ws, msg_id, """
            (() => {
                const opt = document.getElementById('city-opt-mumbai');
                if (opt) opt.click();
            })()
            """); msg_id += 1
            time.sleep(2)
            await drain_events()

            mumbai_url = await evaluate_js(ws, msg_id, "window.location.pathname"); msg_id += 1
            mumbai_kpi = await evaluate_js(ws, msg_id, """
            (() => {
                const title = document.querySelector('.kpi-title-block h3');
                return title ? title.textContent : null;
            })()
            """); msg_id += 1
            print(f"Switched URL: {mumbai_url}, KPI City Header: {mumbai_kpi}")
            assert "mumbai" in mumbai_url, f"Expected URL containing mumbai, got {mumbai_url}"
            assert "mumbai" in (mumbai_kpi or "").lower(), f"Expected Mumbai in KPI header, got {mumbai_kpi}"

            # 3. Test 2D / 3D Pitch Toggle
            print("\n--- 3. Testing 2D / 3D Heatmap Rendering ---")
            btn_3d_state = await evaluate_js(ws, msg_id, """
            (() => {
                const btn = document.querySelector('.map-ctrl-btn.perspective-btn');
                if (!btn) return { error: 'No perspective button' };
                const initial3d = btn.classList.contains('is-3d');
                btn.click();
                return { clicked: true, initial3d };
            })()
            """); msg_id += 1
            time.sleep(1)
            pitch_after = await evaluate_js(ws, msg_id, """
            (() => {
                const btn = document.querySelector('.map-ctrl-btn.perspective-btn');
                return {
                    now3d: btn ? btn.classList.contains('is-3d') : null
                };
            })()
            """); msg_id += 1
            print(f"3D toggle test: initial={btn_3d_state}, after={pitch_after}")
            assert pitch_after.get("now3d") != btn_3d_state.get("initial3d"), "Perspective toggle failed to update 3D state"

            # 3b. Test Interactive Heatmap Cell Selection & Local SHAP Panel
            print("\n--- 3b. Testing Cell Selection & Local SHAP Panel ---")
            # Dispatch mouse click near center of map canvas (e.g. x=720, y=450)
            await send_cmd(ws, msg_id, "Input.dispatchMouseEvent", {
                "type": "mousePressed",
                "x": 720,
                "y": 450,
                "button": "left",
                "clickCount": 1
            }); msg_id += 1
            await send_cmd(ws, msg_id, "Input.dispatchMouseEvent", {
                "type": "mouseReleased",
                "x": 720,
                "y": 450,
                "button": "left",
                "clickCount": 1
            }); msg_id += 1
            time.sleep(2)
            await drain_events()

            cell_panel_state = await evaluate_js(ws, msg_id, """
            (() => {
                const panel = document.querySelector('.cell-inspector-panel');
                if (!panel) return { found: false };
                const cellId = panel.querySelector('.inspector-cell-id')?.textContent;
                const tempVal = panel.querySelector('.inspector-temp-val')?.textContent;
                const tier = panel.querySelector('.inspector-tier-badge')?.textContent;
                const driverRows = panel.querySelectorAll('.driver-row');
                return {
                    found: true,
                    cellId,
                    tempVal,
                    tier: tier?.trim(),
                    driverCount: driverRows.length
                };
            })()
            """); msg_id += 1
            print("Cell Inspector Status:", json.dumps(cell_panel_state, indent=2))
            # Test dismiss via Escape key if opened
            if cell_panel_state.get("found"):
                await send_cmd(ws, msg_id, "Input.dispatchKeyEvent", {
                    "type": "rawKeyDown",
                    "windowsVirtualKeyCode": 27,
                    "key": "Escape",
                    "code": "Escape"
                }); msg_id += 1
                await send_cmd(ws, msg_id, "Input.dispatchKeyEvent", {
                    "type": "keyUp",
                    "windowsVirtualKeyCode": 27,
                    "key": "Escape",
                    "code": "Escape"
                }); msg_id += 1
                time.sleep(0.5)
                closed_check = await evaluate_js(ws, msg_id, "!document.querySelector('.cell-inspector-panel')"); msg_id += 1
                print(f"Cell inspector dismissed via Escape: {closed_check}")
                assert closed_check, "Cell inspector panel did not close on Escape key"

            # 4. Test Map Attribution & Provenance
            print("\n--- 4. Testing Map Attribution & Legal Provenance ---")
            attrib_check = await evaluate_js(ws, msg_id, """
            (() => {
                const watermark = document.querySelector('.map-watermark-provenance');
                const attrib = document.querySelector('.map-attribution-bar');
                const modelledBar = document.querySelector('.modelled-data-bar');
                return {
                    watermarkText: watermark ? watermark.textContent : null,
                    attribLinksCount: attrib ? attrib.querySelectorAll('a').length : 0,
                    hasModelledChip: !!modelledBar
                };
            })()
            """); msg_id += 1
            print("Provenance & Legal Attribution:", json.dumps(attrib_check, indent=2))
            assert attrib_check["attribLinksCount"] >= 2, "Expected OSM and Carto attribution links"
            assert attrib_check["hasModelledChip"], "Expected Modelled Data bar"

            # 5. Test Drivers Page & Feature Inspection
            print("\n--- 5. Testing Drivers Page & SHAP Explanations ---")
            await send_cmd(ws, msg_id, "Page.navigate", {"url": "http://localhost:5173/mumbai/drivers"}); msg_id += 1
            time.sleep(2.5)
            await drain_events()

            drivers_check = await evaluate_js(ws, msg_id, """
            (() => {
                const bars = document.querySelectorAll('.recharts-rectangle');
                const title = document.querySelector('.inspector-panel h3');
                const depPlots = document.querySelectorAll('.dependence-card');
                return {
                    barsCount: bars.length,
                    selectedFeatureName: title ? title.textContent : null,
                    dependencePlotsCount: depPlots.length
                };
            })()
            """); msg_id += 1
            print("Drivers View Inspection:", json.dumps(drivers_check, indent=2))
            assert drivers_check["dependencePlotsCount"] >= 3, "Expected 3 SHAP dependence plots"

            # 6. Test Scenario Simulation & Before/After Sync
            print("\n--- 6. Testing Scenario Simulation & Sync ---")
            await send_cmd(ws, msg_id, "Page.navigate", {"url": "http://localhost:5173/new_delhi/scenarios"}); msg_id += 1
            time.sleep(2.5)
            await drain_events()

            # Select an active intervention preset (index 1 = Cool Roofs Initiative or similar)
            sim_trigger = await evaluate_js(ws, msg_id, """
            (() => {
                const presets = document.querySelectorAll('.btn-preset');
                if (presets.length > 1) {
                    presets[1].click();
                    return { clicked: true, presetName: presets[1].textContent.trim().substring(0, 30) };
                }
                return { clicked: false, count: presets.length };
            })()
            """); msg_id += 1
            print(f"Simulation trigger (Preset 1): {sim_trigger}")

            # Wait for simulation results overlay to appear
            time.sleep(3.5)
            await drain_events()

            results_check = await evaluate_js(ws, msg_id, """
            (() => {
                const summary = document.querySelector('.results-summary');
                if (!summary) return { found: false };
                const metrics = Array.from(summary.querySelectorAll('.result-metric')).map(m => {
                    const label = m.querySelector('.metric-label')?.textContent;
                    const value = m.querySelector('.metric-value')?.textContent;
                    return { label, value };
                });
                const splitMaps = document.querySelectorAll('.split-maps .map-half');
                return {
                    found: true,
                    metrics,
                    splitMapsCount: splitMaps.length
                };
            })()
            """); msg_id += 1
            print("Scenario Simulation Results:", json.dumps(results_check, indent=2))
            assert results_check.get("found"), "Expected simulation results summary overlay"
            assert results_check.get("splitMapsCount") == 2, "Expected 2 synchronized map halves (Before & After)"

            # Check assumptions toggle
            assumptions_check = await evaluate_js(ws, msg_id, """
            (async () => {
                const toggle = document.querySelector('.assumptions-toggle');
                if (!toggle) return { error: 'No toggle' };
                toggle.click();
                await new Promise(r => setTimeout(r, 300));
                const content = document.querySelector('.assumptions-content');
                return { opened: !!content };
            })()
            """); msg_id += 1
            print("Assumptions Drawer Check:", assumptions_check)
            assert assumptions_check.get("opened"), "Expected assumptions drawer to open"

            # 7. Final Error Summary
            await drain_events()
            print("\n--- Final Network & Console Audit ---")
            print(f"Total Console Errors: {len(console_errors)}")
            for ce in console_errors:
                print("  [CONSOLE ERROR]:", json.dumps(ce)[:200])
            print(f"Total Failed Network Requests: {len(network_errors)}")
            for ne in network_errors:
                print("  [NETWORK ERROR]:", ne)

            assert len(console_errors) == 0, f"Found {len(console_errors)} console errors!"
            assert len(network_errors) == 0, f"Found {len(network_errors)} failed network requests!"
            print("\n>>> ALL PRODUCTION READINESS CHECKS PASSED SUCCESSFULLY! <<<")

    finally:
        chrome_proc.terminate()
        print("\nAudit complete, Chrome closed.")

if __name__ == "__main__":
    asyncio.run(run_full_audit())
