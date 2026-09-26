import type { CDPSession, Page } from '@playwright/test';

export interface Point { readonly x: number; readonly y: number }
export interface ViewportTransform { readonly x: number; readonly y: number; readonly zoom: number }

const STEPS = 12;

async function send(cdp: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd', points: readonly Point[]): Promise<void> {
    await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p, id) => ({ x: p.x, y: p.y, id })) });
}

const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** Moves one or more fingers from their start points to their end points in small steps. */
export async function touchGesture(page: Page, from: readonly Point[], to: readonly Point[]): Promise<void> {
    const cdp = await page.context().newCDPSession(page);
    await send(cdp, 'touchStart', from);
    for (let step = 1; step <= STEPS; step += 1) {
        await send(cdp, 'touchMove', from.map((p, i) => lerp(p, to[i] ?? p, step / STEPS)));
        await page.waitForTimeout(16);
    }
    await send(cdp, 'touchEnd', []);
    await cdp.detach();
}

/** Reads the canvas pan/zoom from ReactFlow's viewport transform. */
export async function readViewport(page: Page): Promise<ViewportTransform> {
    const transform = await page.locator('.react-flow__viewport').evaluate((el) => (el as HTMLElement).style.transform);
    const [, x, y, zoom] = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)\s*scale\((-?[\d.]+)\)/.exec(transform) ?? [];
    return { x: Number(x), y: Number(y), zoom: Number(zoom) };
}
