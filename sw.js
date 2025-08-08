// sw.js - Service Worker for Simple Reminders (Based on Working App)
const CACHE_NAME = 'simple-reminders-v2';
const urlsToCache = [
    './',
    './index.html',
    './app.js',
    './manifest.json'
];

// Install
self.addEventListener('install', event => {
    console.log('🔧 SW: Installing Simple Reminders Service Worker...');
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            console.log('📦 SW: Caching app files');
            return cache.addAll(urlsToCache);
        })
    );
    self.skipWaiting();
});

// Activate
self.addEventListener('activate', event => {
    console.log('✅ SW: Activating Simple Reminders Service Worker');
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('🗑️ SW: Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => {
            console.log('🎯 SW: Taking control of all pages');
            return self.clients.claim();
        })
    );
});

// Fetch - Don't intercept Pi server requests (CRITICAL FOR WORKING)
self.addEventListener('fetch', event => {
    // Let Pi server requests (192.168.x.x:3001) go through normally
    if (event.request.url.includes('192.168.') && event.request.url.includes(':3001')) {
        console.log('🔄 SW: Bypassing cache for Pi server request');
        return; // Let the request go through without interception
    }
    
    // Cache other requests
    event.respondWith(
        caches.match(event.request).then(response => {
            if (response) {
                return response;
            }
            return fetch(event.request);
        }).catch(error => {
            console.error('❌ SW: Fetch failed:', error);
            return new Response('Network error', { status: 408 });
        })
    );
});

// Push notification handler - THE KEY TO BACKGROUND NOTIFICATIONS
self.addEventListener('push', event => {
    console.log('🚀 SW: REAL Push notification received from Pi!');
    console.log('📊 SW: Push event data:', event.data ? 'Present' : 'Empty');
    
    let notificationData = {
        title: '⏰ Reminder',
        body: 'Scheduled reminder from your Pi!',
        icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="%233b82f6"/><text x="50" y="65" text-anchor="middle" font-size="30" fill="white">⏰</text></svg>',
        badge: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="%23ef4444"/><text x="50" y="65" text-anchor="middle" font-size="30" fill="white">🔔</text></svg>',
        tag: 'reminder-notification',
        requireInteraction: true,
        vibrate: [200, 100, 200],
        data: { 
            url: self.location.origin,
            timestamp: Date.now(),
            source: 'pi-reminder-server'
        }
    };

    // Parse push data from Pi server
    if (event.data) {
        try {
            const pushData = event.data.json();
            console.log('📦 SW: Parsed Pi server data:', pushData);
            notificationData = { ...notificationData, ...pushData };
        } catch (e) {
            console.log('📝 SW: Push data as text:', event.data.text());
            notificationData.body = event.data.text();
        }
    }

    // iOS-specific optimizations (CRITICAL FOR IOS)
    const userAgent = self.navigator.userAgent || '';
    const isIOS = /iPad|iPhone|iPod/.test(userAgent);
    
    if (isIOS) {
        console.log('🍎 SW: iOS device detected - optimizing notification');
        // Remove actions for iOS (not well supported)
        delete notificationData.actions;
        // Ensure vibration pattern is simple
        notificationData.vibrate = [200, 100, 200];
        // Ensure interaction required for iOS
        notificationData.requireInteraction = true;
    } else {
        // Add action buttons for desktop/Android
        notificationData.actions = [
            { 
                action: 'open', 
                title: '📱 Open App'
            },
            { 
                action: 'dismiss', 
                title: '✕ Dismiss'
            }
        ];
    }

    console.log('📱 SW: Showing notification:', notificationData.title);

    // Show the notification (THIS WORKS EVEN WHEN APP IS CLOSED!)
    event.waitUntil(
        self.registration.showNotification(notificationData.title, notificationData)
            .then(() => {
                console.log('✅ SW: Notification displayed successfully');
                
                // Send message to app if it's open
                return self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
            })
            .then(clients => {
                if (clients && clients.length > 0) {
                    clients.forEach(client => {
                        client.postMessage({
                            type: 'PUSH_RECEIVED',
                            notification: notificationData,
                            timestamp: Date.now()
                        });
                    });
                    console.log('📨 SW: Notified app about push notification');
                }
            })
            .catch(error => {
                console.error('❌ SW: Error showing notification:', error);
            })
    );
});

// Notification click handler
self.addEventListener('notificationclick', event => {
    console.log('🖱️ SW: Notification clicked');
    console.log('🎯 SW: Action:', event.action || 'default');
    
    event.notification.close();

    // Handle action buttons
    if (event.action === 'dismiss') {
        console.log('✕ SW: Notification dismissed');
        return;
    }

    // Default action or 'open' action - focus/open the app
    event.waitUntil(
        self.clients.matchAll({ 
            type: 'window',
            includeUncontrolled: true 
        }).then(clientList => {
            console.log('🔍 SW: Found', clientList.length, 'open windows');
            
            // Try to focus an existing window
            for (const client of clientList) {
                if (client.url.includes(self.location.origin) && 'focus' in client) {
                    console.log('🎯 SW: Focusing existing window');
                    return client.focus().then(client => {
                        // Send message to the focused client
                        client.postMessage({
                            type: 'NOTIFICATION_CLICKED',
                            action: event.action || 'default',
                            data: event.notification.data,
                            timestamp: Date.now()
                        });
                        return client;
                    });
                }
            }
            
            // No suitable window found, open new one
            if (clients.openWindow) {
                console.log('🆕 SW: Opening new window');
                return clients.openWindow('./').then(client => {
                    // Wait a bit for the new window to load, then send message
                    setTimeout(() => {
                        if (client) {
                            client.postMessage({
                                type: 'NOTIFICATION_CLICKED',
                                action: event.action || 'default',
                                data: event.notification.data,
                                timestamp: Date.now()
                            });
                        }
                    }, 1000);
                    return client;
                });
            }
        }).catch(error => {
            console.error('❌ SW: Error handling notification click:', error);
        })
    );
});

// Handle push subscription changes (IMPORTANT FOR RELIABILITY)
self.addEventListener('pushsubscriptionchange', event => {
    console.log('🔄 SW: Push subscription changed - re-subscribing...');
    
    event.waitUntil(
        // Re-subscribe with new subscription
        self.registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: event.oldSubscription.options.applicationServerKey
        }).then(newSubscription => {
            console.log('✅ SW: Re-subscribed with new subscription');
            
            // Send new subscription to Pi server
            return fetch('https://192.168.0.147:3001/subscribe', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(newSubscription)
            });
        }).then(response => {
            if (response.ok) {
                console.log('✅ SW: New subscription sent to Pi server');
            } else {
                console.error('❌ SW: Failed to send new subscription to Pi server');
            }
        }).catch(error => {
            console.error('❌ SW: Error handling subscription change:', error);
        })
    );
});

// Listen for messages from the main app
self.addEventListener('message', event => {
    console.log('📨 SW: Received message from app:', event.data);
    
    if (event.data && event.data.type === 'SKIP_WAITING') {
        console.log('⏭️ SW: Skip waiting requested');
        self.skipWaiting();
    }
    
    if (event.data && event.data.type === 'GET_VERSION') {
        event.ports[0].postMessage({ 
            version: CACHE_NAME,
            type: 'simple-reminders'
        });
    }
});

// Error handling
self.addEventListener('error', event => {
    console.error('❌ SW: Service Worker error:', event.error);
});

self.addEventListener('unhandledrejection', event => {
    console.error('❌ SW: Unhandled promise rejection:', event.reason);
});

console.log('🚀 SW: Simple Reminders Service Worker loaded and ready for background notifications!');
