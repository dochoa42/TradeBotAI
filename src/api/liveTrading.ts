import { LiveStatus, PlacePaperOrderRequest } from "../types/trading";

type KillSwitchState = {
  tripped: boolean;
  reason?: string | null;
};

const BASE_URL = "/api/live";

export async function fetchPaperStatus(): Promise<LiveStatus> {
  const res = await fetch(`${BASE_URL}/paper/status`);
  if (!res.ok) {
    throw new Error(`Failed to fetch paper status: ${res.status}`);
  }
  return res.json();
}

export async function placePaperOrder(
  body: PlacePaperOrderRequest
): Promise<LiveStatus> {
  const res = await fetch(`${BASE_URL}/paper/place_order`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Failed to place paper order: ${res.status}`);
  }
  return res.json();
}

export async function cancelPaperOrder(orderId: string): Promise<LiveStatus> {
  const res = await fetch(`${BASE_URL}/paper/cancel_order`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ order_id: orderId }),
  });
  if (!res.ok) {
    throw new Error(`Failed to cancel paper order: ${res.status}`);
  }
  return res.json();
}

export async function fetchKillSwitch(): Promise<KillSwitchState> {
  const res = await fetch(`${BASE_URL}/paper/kill-switch`);
  if (!res.ok) {
    throw new Error(`Failed to fetch kill switch: ${res.status}`);
  }
  return res.json();
}

export async function toggleKillSwitch(
  tripped: boolean,
  reason?: string
): Promise<KillSwitchState> {
  const res = await fetch(`${BASE_URL}/paper/kill-switch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tripped, reason }),
  });
  if (!res.ok) {
    throw new Error(`Failed to toggle kill switch: ${res.status}`);
  }
  return res.json();
}
