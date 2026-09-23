import { test } from "node:test";
import assert from "node:assert/strict";
import { PermissionEngine, DEFAULT_POLICY } from "@jarvis/core";

test("read actions are allowed without approval", () => {
  const engine = new PermissionEngine();
  const d = engine.decide("read");
  assert.equal(d.allowed, true);
  assert.equal(d.requiresApproval, false);
});

test("safe writes are allowed without approval", () => {
  const engine = new PermissionEngine();
  const d = engine.decide("safe_write");
  assert.equal(d.allowed, true);
  assert.equal(d.requiresApproval, false);
});

test("external writes require approval", () => {
  const engine = new PermissionEngine();
  const d = engine.decide("external_write");
  assert.equal(d.allowed, true);
  assert.equal(d.requiresApproval, true);
});

test("critical actions require approval", () => {
  const engine = new PermissionEngine();
  const d = engine.decide("critical");
  assert.equal(d.requiresApproval, true);
});

test("bulk counts above threshold escalate to approval (§71)", () => {
  const engine = new PermissionEngine();
  const d = engine.decide("external_write", { bulkCount: 11, bulkKind: "emailRecipients" });
  assert.equal(d.requiresApproval, true);
  assert.match(d.reason, /Bulk action/);
});

test("bulk counts at or below threshold do not escalate", () => {
  const engine = new PermissionEngine();
  const d = engine.decide("external_write", { bulkCount: DEFAULT_POLICY.bulk.emailRecipients, bulkKind: "emailRecipients" });
  assert.equal(d.requiresApproval, true); // still external_write by base risk
  const d2 = engine.decide("read", { bulkCount: 3, bulkKind: "recordDeletes" });
  assert.equal(d2.requiresApproval, false);
});
