"""Controlled local network performance & concurrency benchmark (p50, p95, p99)."""

from __future__ import annotations

import asyncio
import json
import statistics
import time
import httpx

BASE_URL = "http://127.0.0.1:8000"


def percentile(sorted_vals: list[float], pct: float) -> float:
    if not sorted_vals:
        return 0.0
    idx = min(len(sorted_vals) - 1, max(0, int(round((pct / 100.0) * (len(sorted_vals) - 1)))))
    return round(sorted_vals[idx], 2)


async def run_load() -> None:
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=10.0) as client:
        login = await client.post("/api/auth/login", json={"username": "admin.demo", "password": "Admin@2026!"})
        assert login.status_code == 200, login.text
        token = login.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        endpoints = [
            "/api/health",
            "/api/dashboard",
            "/api/assets",
            "/api/inspections",
            "/api/work-orders",
            "/api/calendar",
            "/api/analytics",
            "/api/search?q=Switch",
        ]

        # 200 concurrent requests across 20 workers
        sem = asyncio.Semaphore(20)
        latencies_ms: list[float] = []
        errors: list[str] = []

        async def hit(ep: str) -> None:
            async with sem:
                t0 = time.perf_counter()
                try:
                    r = await client.get(ep, headers=headers)
                    dt = (time.perf_counter() - t0) * 1000
                    latencies_ms.append(dt)
                    if r.status_code != 200:
                        errors.append(f"{ep}:{r.status_code}")
                except Exception as exc:
                    errors.append(f"{ep}:{type(exc).__name__}")

        t_start = time.perf_counter()
        tasks = [hit(endpoints[i % len(endpoints)]) for i in range(200)]
        await asyncio.gather(*tasks)
        total_sec = round(time.perf_counter() - t_start, 2)

        latencies_ms.sort()
        summary = {
            "total_requests": len(tasks),
            "concurrency": 20,
            "total_duration_sec": total_sec,
            "throughput_rps": round(len(tasks) / max(0.01, total_sec), 2),
            "error_count": len(errors),
            "errors": errors[:10],
            "p50_ms": percentile(latencies_ms, 50),
            "p95_ms": percentile(latencies_ms, 95),
            "p99_ms": percentile(latencies_ms, 99),
            "mean_ms": round(statistics.mean(latencies_ms), 2) if latencies_ms else 0,
            "max_ms": round(max(latencies_ms), 2) if latencies_ms else 0,
        }
        print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    asyncio.run(run_load())
