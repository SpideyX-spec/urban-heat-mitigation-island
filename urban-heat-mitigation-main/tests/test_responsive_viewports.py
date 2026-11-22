import asyncio
import json
import subprocess
import time
import urllib.request
import websockets

CHROME_PATH = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
PORT = 9222

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

async def run_tests():
    chrome_proc = subprocess.Popen([
        CHROME_PATH,
        f"--remote-debugging-port={PORT}",
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        "--user-data-dir=C:\\temp\\chrome_test_profile"
    ])
    print("Launched headless Chrome on port", PORT)
    time.sleep(2)

    try:
        # Get target websocket URL
        with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/list") as r:
            targets = json.loads(r.read().decode())
        ws_url = targets[0]["webSocketDebuggerUrl"]
        print("Connected to target:", ws_url)

        async with websockets.connect(ws_url) as ws:
            msg_id = 1

            viewports = [
                {"name": "Desktop 1440px", "width": 1440, "height": 900},
                {"name": "Tablet Landscape 1024px", "width": 1024, "height": 768},
                {"name": "Tablet Portrait 768px", "width": 768, "height": 1024},
                {"name": "Mobile 390px", "width": 390, "height": 844},
                {"name": "Compact Mobile 360px", "width": 360, "height": 800},
            ]

            routes = [
                ("/new_delhi/map", "Heat Map"),
                ("/new_delhi/scenarios", "Scenarios"),
                ("/new_delhi/drivers", "Heat Drivers"),
            ]

            all_passed = True

            for route, page_name in routes:
                url = f"http://localhost:5173{route}"
                print(f"\n==========================================")
                print(f"Testing Page: {page_name} ({url})")
                print(f"==========================================")

                # Reset to desktop viewport before navigating
                msg_id += 1
                await send_cmd(ws, msg_id, "Emulation.setDeviceMetricsOverride", {
                    "width": 1440,
                    "height": 900,
                    "deviceScaleFactor": 1,
                    "mobile": False
                })

                # Navigate
                msg_id += 1
                await send_cmd(ws, msg_id, "Page.navigate", {"url": url})
                await asyncio.sleep(2.0)

                for vp in viewports:
                    msg_id += 1
                    # Set viewport metrics
                    await send_cmd(ws, msg_id, "Emulation.setDeviceMetricsOverride", {
                        "width": vp["width"],
                        "height": vp["height"],
                        "deviceScaleFactor": 1,
                        "mobile": vp["width"] <= 768,
                        "screenOrientation": {"angle": 0, "type": "portraitPrimary" if vp["width"] < vp["height"] else "landscapePrimary"}
                    })
                    msg_id += 1
                    await send_cmd(ws, msg_id, "Runtime.evaluate", {
                        "expression": "window.dispatchEvent(new Event('resize'))"
                    })
                    await asyncio.sleep(0.7)

                    # Evaluate layout metrics via JS
                    eval_js = """
                    (() => {
                        const doc = document.documentElement;
                        const body = document.body;
                        const scrollW = Math.max(doc.scrollWidth, body.scrollWidth);
                        const clientW = doc.clientWidth;
                        const innerW = window.innerWidth;
                        const hasHorizontalOverflow = scrollW > innerW + 1;

                        const topTabs = document.querySelector('.top-nav-tabs');
                        const topTabsVisible = topTabs ? window.getComputedStyle(topTabs).display !== 'none' : false;

                        const mobileNav = document.querySelector('.mobile-bottom-nav');
                        const mobileNavVisible = mobileNav ? window.getComputedStyle(mobileNav).display !== 'none' : false;

                        // Scenarios specific checks
                        const compareToggle = document.querySelector('.scenario-mobile-compare-toggle');
                        const compareToggleVisible = compareToggle ? window.getComputedStyle(compareToggle).display !== 'none' : false;

                        const builderBottomBar = document.querySelector('.mobile-builder-bottom-bar');
                        const builderBottomBarVisible = builderBottomBar ? window.getComputedStyle(builderBottomBar).display !== 'none' : false;

                        // MapView specific checks
                        const mobileKpiPill = document.querySelector('.mobile-kpi-pill');
                        const mobileKpiPillVisible = mobileKpiPill ? window.getComputedStyle(mobileKpiPill).display !== 'none' : false;

                        return {
                            innerW,
                            scrollW,
                            hasHorizontalOverflow,
                            topTabsVisible,
                            mobileNavVisible,
                            compareToggleVisible,
                            builderBottomBarVisible,
                            mobileKpiPillVisible
                        };
                    })()
                    """
                    msg_id += 1
                    eval_res = await send_cmd(ws, msg_id, "Runtime.evaluate", {
                        "expression": eval_js,
                        "returnByValue": True
                    })
                    val = eval_res["result"]["result"]["value"]

                    overflow_status = "FAIL (OVERFLOW!)" if val["hasHorizontalOverflow"] else "PASS (No overflow)"
                    print(f"[{vp['name']} {vp['width']}x{vp['height']}] "
                          f"Window: {val['innerW']}px, Scroll: {val['scrollW']}px -> {overflow_status}")

                    if val["hasHorizontalOverflow"]:
                        all_passed = False
                        print(f"   WARNING: Horizontal overflow detected! ScrollW ({val['scrollW']}) > InnerW ({val['innerW']})")

                    # Functional checks per viewport
                    if vp["width"] <= 640:
                        if not val["mobileNavVisible"]:
                            print(f"   Note: mobile bottom nav expected visible at {vp['width']}px")
                        if val["topTabsVisible"]:
                            print(f"   Note: top tabs expected hidden at {vp['width']}px")
                    else:
                        if val["mobileNavVisible"]:
                            print(f"   Note: mobile bottom nav expected hidden at {vp['width']}px")
                        if not val["topTabsVisible"]:
                            print(f"   Note: top tabs expected visible at {vp['width']}px")

                    if route == "/new_delhi/scenarios" and vp["width"] < 900:
                        if val["compareToggleVisible"]:
                            print(f"   ✓ Mobile Before/After segmented comparison toggle active")
                        if val["builderBottomBarVisible"]:
                            print(f"   ✓ Mobile Scenario Builder bottom drawer trigger active")

                    if route == "/new_delhi/map" and vp["width"] < 768:
                        if val["mobileKpiPillVisible"]:
                            print(f"   ✓ Mobile floating KPI overview pill active")

            print("\n==========================================")
            if all_passed:
                print("ALL RESPONSIVE VIEWPORT TESTS PASSED WITH ZERO HORIZONTAL OVERFLOW!")
            else:
                print("SOME VIEWPORT TESTS REPORTED ISSUES.")
            print("==========================================")

    finally:
        chrome_proc.terminate()
        try:
            chrome_proc.wait(timeout=3)
        except Exception:
            chrome_proc.kill()
        print("Chrome process terminated cleanly.")

if __name__ == "__main__":
    asyncio.run(run_tests())
