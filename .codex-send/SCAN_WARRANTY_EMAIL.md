# Email to Scan Computers (3XS) — copy everything below the line
# Fill in: [ORDER NUMBER], [DELIVERY DATE], [YOUR NAME]. Attach: gpu-evidence-20260722.zip (on Desktop).
# Send to Scan customer support / returns, and reference it if you phone them.

---

**Subject:** 3XS system, Order #[ORDER NUMBER] — five GPU blue-screens in first week — rejecting goods under Consumer Rights Act 2015 — replacement or refund requested

Hi,

I purchased a 3XS gaming PC from you (Order #[ORDER NUMBER], delivered [DELIVERY DATE]). Within four days of first use the machine began crashing repeatedly, and it has now suffered **five blue-screen crashes in under 14 hours of use**, all caused by the NVIDIA graphics card failing and Windows being unable to recover it. I have systematically eliminated every software cause (full detail below). This is a defective unit, and as the fault arose within 30 days of delivery I am exercising my **short-term right to reject under the Consumer Rights Act 2015**. Please arrange a replacement or refund and advise your returns process.

**System (3XS build, all settings stock as shipped):**
Ryzen 7 5700X · ASUS TUF GAMING A520M-PLUS WIFI (BIOS 3636) · NVIDIA GeForce RTX 5060 Ti 16 GB (VBIOS 98.06.39.80.12) · 32 GB Corsair DDR4-3200 · Windows 11 25H2 (26200.8875)

**Complete failure log:**

| Date/time | Event |
|---|---|
| 21 Jul 01:59 | Hard shutdown, no dump recorded (earliest incident) |
| 21 Jul 12:29 | GPU error storm (driver event 153 ×40+, retries for 80 s), display lost, desktop fell back to 1024×768 |
| 21 Jul 12:40 | **BSOD #1** — 0x116 VIDEO_TDR_FAILURE, nvlddmkm.sys, status 0xC000009A |
| 21 Jul 12:59 | **BSOD #2** — 0x116, identical fault address in nvlddmkm.sys, same status |
| 21 Jul 13:00–13:15 | Card failed to restart after reboot (Code 43); repeated `nvlddmkm failed DdiStartDevice, 0xC000009A` live kernel reports — including one **after** a clean install of a newer driver |
| 21 Jul 13:56 | **BSOD #3** — 0x10E (0x37) VIDEO_MEMORY_MANAGEMENT_INTERNAL during crash recovery |
| 21 Jul 15:14 | **BSOD #4** — 0x116, same signature, **while the machine sat idle at the desktop** |
| 21 Jul 16:01 | GPU error storm and lock-up; on the next boot the NVIDIA driver failed to load at all (Microsoft Basic Display) |
| 22 Jul 01:03 & 01:06 | Two further GPU error events within 27 min of a cold boot, on a fully mitigated configuration |
| 22 Jul 01:16 | **BSOD #5** — 0x116, identical signature again (dump 072226-9718-01.dmp) |

**Microsoft's automated crash classification (WER) for every blue-screen:** `0x116_TdrBCR:4:C000009A_Tdr:A_IMAGE_nvlddmkm.sys_Blackwell` — i.e. the GPU hung and could not be reset, blamed on the graphics card's driver stack on Blackwell silicon.

**Software causes eliminated — the fault reproduced after every one of these steps:**

- **Three NVIDIA driver releases**, each clean-installed: 610.47 (as shipped), 610.74, and NVIDIA's 610.52 hotfix. All five BSODs fault at the equivalent driver code address (0x1958210 / 0x19582A0 per build) — a fixed, repeatable failure, not random corruption.
- **Windows HDR disabled** — crashed again in SDR.
- **Hardware-accelerated GPU scheduling (HAGS) disabled** — crashed again.
- **Pagefile fixed at 24 GB** (removing any memory-pressure factor) — crashed again.
- **Full cold boot** before the final test — crashed again within 40 minutes.
- One crash occurred **at idle**, ruling out any specific game or application.
- No overclocking utilities present; GPU power limit at stock 180 W; stock Windows TDR configuration (verified); temperatures 35–43 °C throughout; **zero WHEA hardware errors and zero PCIe replay errors** logged.

Given the machine is under a week old, the fault is present across all software configurations, and it renders the system unusable for its purpose (it crashes even at idle), I am rejecting the goods within the 30-day short-term period and request a **replacement unit or full refund**, whichever you can process fastest. All five minidumps, professional WinDbg crash analyses, and full event-log exports are attached (gpu-evidence-20260722.zip) and I can provide anything further you need.

Please confirm the returns process and collection arrangements.

Regards,
[YOUR NAME]
Order #[ORDER NUMBER] · [PHONE / EMAIL]
