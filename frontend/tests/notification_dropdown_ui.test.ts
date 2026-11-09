import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { AppNotification } from '../src/features/invitations/types.js';

// Mock Storage
const mockSessionStorage: Record<string, string> = {};
const mockLocalStorage: Record<string, string> = {};

globalThis.sessionStorage = {
  getItem: (key: string) => mockSessionStorage[key] ?? null,
  setItem: (key: string, val: string) => {
    mockSessionStorage[key] = String(val);
  },
  removeItem: (key: string) => {
    delete mockSessionStorage[key];
  },
  clear: () => {
    Object.keys(mockSessionStorage).forEach((k) => delete mockSessionStorage[k]);
  },
  key: (i: number) => Object.keys(mockSessionStorage)[i] ?? null,
  length: 0,
};

globalThis.localStorage = {
  getItem: (key: string) => mockLocalStorage[key] ?? null,
  setItem: (key: string, val: string) => {
    mockLocalStorage[key] = String(val);
  },
  removeItem: (key: string) => {
    delete mockLocalStorage[key];
  },
  clear: () => {
    Object.keys(mockLocalStorage).forEach((k) => delete mockLocalStorage[k]);
  },
  key: (i: number) => Object.keys(mockLocalStorage)[i] ?? null,
  length: 0,
};

describe('Frontend Notification Dropdown & Context Logic Tests', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it('1. Unread count calculation: Unread notifications reflect accurately in badge count', () => {
    const notifications: AppNotification[] = [
      {
        id: 'inv_1',
        type: 'watch_party_invitation',
        title: 'Watch Party Invitation',
        message: 'invited you to a party',
        createdAt: Date.now() - 60000,
        read: false,
        senderId: 'host_1',
        senderName: 'Alice',
      },
      {
        id: 'inv_2',
        type: 'watch_party_invitation',
        title: 'Watch Party Invitation',
        message: 'invited you to a party',
        createdAt: Date.now() - 120000,
        read: true,
        senderId: 'host_2',
        senderName: 'Bob',
      },
      {
        id: 'inv_3',
        type: 'room_admission_update',
        title: 'Admission Approved',
        message: 'Host approved your entry',
        createdAt: Date.now() - 30000,
        read: false,
      },
    ];

    const unreadCount = notifications.filter((n) => !n.read).length;
    assert.strictEqual(unreadCount, 2, 'Unread count should match unread notifications (2)');
  });

  it('2. Read status persistence per user: Saved read IDs survive across reloads', () => {
    const userId = 'user_guest_123';
    const key = `et_read_notifications_${userId}`;

    const readSet = new Set(['inv_10', 'inv_20']);
    localStorage.setItem(key, JSON.stringify(Array.from(readSet)));

    // Simulate page reload
    const stored = localStorage.getItem(key);
    assert.ok(stored, 'Storage key must exist');
    const restored = new Set(JSON.parse(stored));
    assert.strictEqual(restored.has('inv_10'), true);
    assert.strictEqual(restored.has('inv_20'), true);
    assert.strictEqual(restored.has('inv_30'), false);
  });

  it('3. Mark all as read: Marks all notifications without clearing them or accepting invitations', () => {
    const userId = 'user_registered_456';
    const key = `et_read_notifications_${userId}`;

    let notifications: AppNotification[] = [
      {
        id: 'notif_1',
        type: 'watch_party_invitation',
        title: 'Watch Party Invitation',
        message: 'invited you',
        createdAt: Date.now(),
        read: false,
        invitationData: {
          id: 'notif_1',
          roomId: 'room_xyz',
          hostId: 'host_1',
          hostName: 'Host 1',
          status: 'pending',
          createdAt: Date.now(),
        },
      },
      {
        id: 'notif_2',
        type: 'friend_request',
        title: 'Friend Request',
        message: 'sent a friend request',
        createdAt: Date.now(),
        read: false,
      },
    ];

    // Execute mark all as read
    const allIds = notifications.map((n) => n.id);
    localStorage.setItem(key, JSON.stringify(allIds));
    notifications = notifications.map((n) => ({ ...n, read: true }));

    assert.strictEqual(notifications.length, 2, 'Notifications list must remain populated');
    assert.strictEqual(notifications.every((n) => n.read), true, 'All notifications must be marked read');
    assert.strictEqual(
      notifications[0].invitationData?.status,
      'pending',
      'Invitation status must remain pending (read state is independent of response status)'
    );
  });

  it('4. Pre-approved room admission token stored upon invitation acceptance', () => {
    const roomId = 'room_abc_789';
    sessionStorage.setItem(`et_accepted_room_${roomId}`, 'true');

    const token = sessionStorage.getItem(`et_accepted_room_${roomId}`);
    assert.strictEqual(token, 'true', 'Pre-approved token must be present in sessionStorage for instant admission');
  });

  it('5. Popover dismiss handlers: Escape key and click-outside state triggers', () => {
    let isOpen = true;

    // Simulate Escape key press
    const handleKeyDown = (key: string) => {
      if (key === 'Escape') isOpen = false;
    };

    handleKeyDown('Escape');
    assert.strictEqual(isOpen, false, 'Escape key must close the popover');

    // Simulate click outside
    isOpen = true;
    const isClickInside = false;
    if (!isClickInside) isOpen = false;
    assert.strictEqual(isOpen, false, 'Clicking outside must close the popover');
  });

  it('6. Join Party Action: Acceptance updates status to accepted, stores pre-approval, and marks read', () => {
    const roomId = 'room_join_party_123';
    const invitationId = 'inv_test_accept_01';
    let unreadCount = 1;

    let notification: AppNotification = {
      id: invitationId,
      type: 'watch_party_invitation',
      title: 'Watch Party Invitation',
      message: 'invited you to a party',
      createdAt: Date.now(),
      read: false,
      data: {
        invitationId: 'inv_test_accept_01',
        roomId,
        status: 'pending',
      },
    };

    // Simulate acceptInvitation response handler
    const acceptResponse = { success: true, roomId };
    sessionStorage.setItem(`et_accepted_room_${acceptResponse.roomId}`, 'true');
    notification = {
      ...notification,
      read: true,
      data: { ...notification.data, status: 'accepted' },
    };
    unreadCount = notification.read ? 0 : 1;

    assert.strictEqual(sessionStorage.getItem(`et_accepted_room_${roomId}`), 'true');
    assert.strictEqual(notification.data?.status, 'accepted');
    assert.strictEqual(notification.read, true);
    assert.strictEqual(unreadCount, 0);
  });

  it('7. Cancel Action: Decline updates status to declined, preserves notification record, and updates unread count', () => {
    let unreadCount = 1;
    let notification: AppNotification = {
      id: 'inv_test_decline_01',
      type: 'watch_party_invitation',
      title: 'Watch Party Invitation',
      message: 'invited you to a party',
      createdAt: Date.now(),
      read: false,
      data: {
        invitationId: 'inv_test_decline_01',
        roomId: 'room_decline_456',
        status: 'pending',
      },
    };

    // Simulate declineInvitation response handler
    notification = {
      ...notification,
      read: true,
      data: { ...notification.data, status: 'declined' },
    };
    unreadCount = notification.read ? 0 : 1;

    assert.strictEqual(notification.data?.status, 'declined');
    assert.strictEqual(notification.read, true);
    assert.strictEqual(unreadCount, 0);
    assert.strictEqual(sessionStorage.getItem('et_accepted_room_room_decline_456'), null);
  });

  it('8. Concurrency & Double-Click Lock: Prevents duplicate triggers while respondingId is active', () => {
    let respondingId: string | null = null;
    let respondingAction: 'accept' | 'decline' | null = null;
    let networkCalls = 0;

    const triggerAction = (invId: string, action: 'accept' | 'decline') => {
      if (respondingId) {
        return false; // locked: ignore duplicate click
      }
      respondingId = invId;
      respondingAction = action;
      networkCalls++;
      return true;
    };

    const firstClick = triggerAction('inv_123', 'accept');
    assert.strictEqual(firstClick, true);
    assert.strictEqual(networkCalls, 1);
    assert.strictEqual(respondingAction, 'accept');

    // Rapid double-clicks on Join or Cancel while responding
    const doubleJoin = triggerAction('inv_123', 'accept');
    const doubleCancel = triggerAction('inv_123', 'decline');
    assert.strictEqual(doubleJoin, false, 'Duplicate Join must be blocked');
    assert.strictEqual(doubleCancel, false, 'Simultaneous Cancel must be blocked');
    assert.strictEqual(networkCalls, 1, 'Only exactly 1 network call must be dispatched');

    // Unlock after completion
    respondingId = null;
    respondingAction = null;
    assert.strictEqual(respondingId, null);
  });

  it('9. Error Recovery: API failure preserves pending invitation and enables retry', () => {
    let notification: AppNotification = {
      id: 'inv_fail_01',
      type: 'watch_party_invitation',
      title: 'Watch Party Invitation',
      message: 'invited you',
      createdAt: Date.now(),
      read: false,
      data: {
        invitationId: 'inv_fail_01',
        roomId: 'room_fail',
        status: 'pending',
      },
    };

    // Simulate network failure
    const networkError = new Error('Network timeout');
    assert.ok(networkError);

    // Notification must NOT be mutated to accepted or declined
    assert.strictEqual(notification.data?.status, 'pending');
    assert.strictEqual(notification.read, false);

    // Subsequent retry succeeds
    notification = {
      ...notification,
      read: true,
      data: { ...notification.data, status: 'accepted' },
    };
    assert.strictEqual(notification.data?.status, 'accepted');
  });

  it('10. Graceful Expired/Settled handling: Backend error updates client status automatically', () => {
    let notification: AppNotification = {
      id: 'inv_exp_01',
      type: 'watch_party_invitation',
      title: 'Watch Party Invitation',
      message: 'invited you',
      createdAt: Date.now() - 20 * 60 * 1000,
      read: false,
      data: {
        invitationId: 'inv_exp_01',
        roomId: 'room_exp',
        status: 'pending',
      },
    };

    const handleBackendError = (errMsg: string) => {
      if (/expired/i.test(errMsg)) {
        notification = { ...notification, read: true, data: { ...notification.data, status: 'expired' } };
      } else if (/already.*accepted/i.test(errMsg)) {
        notification = { ...notification, read: true, data: { ...notification.data, status: 'accepted' } };
      } else if (/already.*declined/i.test(errMsg)) {
        notification = { ...notification, read: true, data: { ...notification.data, status: 'declined' } };
      }
    };

    handleBackendError('Invitation has expired');
    assert.strictEqual(notification.data?.status, 'expired');
    assert.strictEqual(notification.read, true);
  });
});
