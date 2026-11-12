/*
 * The contents of this file are subject to the terms of the Common Development and
 * Distribution License (the License). You may not use this file except in compliance with the
 * License.
 *
 * You can obtain a copy of the License at legal/CDDLv1.1.txt. See the License for the
 * specific language governing permission and limitations under the License.
 *
 * When distributing Covered Software, include this CDDL Header Notice in each file and include
 * the License file at legal/CDDLv1.1.txt. If applicable, add the following below the CDDL
 * Header, with the fields enclosed by brackets [] replaced by your own identifying
 * information: "Portions copyright [year] [name of copyright owner]".
 *
 * Copyright 2026 Wren Security. All rights reserved.
 */
package org.forgerock.openidm.script;

import static org.assertj.core.api.Assertions.assertThat;
import static org.forgerock.json.JsonValue.json;
import static org.forgerock.json.JsonValue.object;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.lang.management.ManagementFactory;
import java.lang.management.ThreadInfo;
import java.lang.management.ThreadMXBean;
import java.util.Dictionary;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import javax.script.ScriptException;

import org.forgerock.json.JsonValue;
import org.forgerock.json.resource.RequestHandler;
import org.forgerock.openidm.core.IdentityServer;
import org.forgerock.openidm.core.PropertyAccessor;
import org.forgerock.script.ScriptEntry;
import org.forgerock.script.ScriptEvent;
import org.forgerock.script.ScriptName;
import org.forgerock.script.ScriptRegistry;
import org.mockito.ArgumentCaptor;
import org.mockito.ArgumentMatchers;
import org.osgi.framework.BundleContext;
import org.osgi.framework.ServiceRegistration;
import org.testng.annotations.BeforeClass;
import org.testng.annotations.BeforeMethod;
import org.testng.annotations.Test;

/**
 * Tests registration of the request handler in reaction to script events.
 */
public class AbstractScriptedServiceTest {

    private static final JsonValue CONFIG = json(object());

    private BundleContext bundleContext;
    private ScriptRegistry scriptRegistry;
    private ScriptName scriptName;
    private ServiceRegistration<RequestHandler> registration;
    private TestScriptedService service;

    @BeforeClass
    public void initIdentityServer() {
        // required by ScriptedRequestHandler
        if (!IdentityServer.isInitialized()) {
            IdentityServer.initInstance((PropertyAccessor) null);
        }
    }

    @BeforeMethod
    @SuppressWarnings("unchecked")
    public void setUp() throws ScriptException {
        bundleContext = mock(BundleContext.class);
        scriptRegistry = mock(ScriptRegistry.class);
        registration = mock(ServiceRegistration.class);
        scriptName = new ScriptName("script", "javascript");
        ScriptEntry scriptEntry = mock(ScriptEntry.class);
        when(scriptEntry.getName()).thenReturn(scriptName);
        when(scriptRegistry.takeScript(any(JsonValue.class))).thenReturn(scriptEntry);
        when(bundleContext.registerService(eq(RequestHandler.class), any(RequestHandler.class),
                ArgumentMatchers.<Dictionary<String, ?>>any())).thenReturn(registration);
        service = new TestScriptedService(bundleContext, scriptRegistry);
        service.registerService(bundleContext, CONFIG);
    }

    @Test
    public void shouldNotRegisterTwiceWhenScriptIsRegisteredAgain() throws ScriptException {
        service.scriptChanged(event(ScriptEvent.REGISTERED));

        verifyRegistrations(1);
    }

    @Test
    public void shouldUnregisterOnceWhenScriptIsUnregistered() throws ScriptException {
        service.scriptChanged(event(ScriptEvent.UNREGISTERING));
        service.scriptChanged(event(ScriptEvent.UNREGISTERING));
        service.unregisterService();

        verify(registration, times(1)).unregister();
    }

    @Test
    public void shouldRegisterSameHandlerWhenScriptIsRestored() throws ScriptException {
        service.scriptChanged(event(ScriptEvent.UNREGISTERING));
        service.scriptChanged(event(ScriptEvent.REGISTERED));

        List<RequestHandler> handlers = verifyRegistrations(2);
        // the handler keeps the script entry taken for the configuration
        assertThat(handlers.get(1)).isSameAs(handlers.get(0));
    }

    @Test
    public void shouldNotRegisterAfterDeactivation() throws ScriptException {
        service.unregisterService();
        verify(registration).unregister();

        service.scriptChanged(event(ScriptEvent.REGISTERED));

        verifyRegistrations(1);
    }

    @Test
    @SuppressWarnings("unchecked")
    public void shouldUnregisterHandlerRegisteredDuringDeactivation() throws Exception {
        service.scriptChanged(event(ScriptEvent.UNREGISTERING));
        // block the registration of the restored script until deactivation has started
        ServiceRegistration<RequestHandler> restored = mock(ServiceRegistration.class);
        CountDownLatch registering = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        when(bundleContext.registerService(eq(RequestHandler.class), any(RequestHandler.class),
                ArgumentMatchers.<Dictionary<String, ?>>any())).thenAnswer(invocation -> {
                    registering.countDown();
                    assertThat(release.await(10, TimeUnit.SECONDS)).isTrue();
                    return restored;
                });
        AtomicReference<Throwable> failure = new AtomicReference<>();
        Thread events = new Thread(() -> {
            try {
                service.scriptChanged(event(ScriptEvent.REGISTERED));
            } catch (Throwable e) {
                failure.set(e);
            }
        });
        events.start();
        assertThat(registering.await(10, TimeUnit.SECONDS)).isTrue();

        Thread deactivation = new Thread(service::unregisterService);
        deactivation.start();
        // deactivation waits for the lock held by the event that is registering the handler
        assertThat(waitForLockOwnedBy(deactivation, events)).isTrue();
        release.countDown();
        events.join(10_000);
        deactivation.join(10_000);

        assertThat(events.isAlive()).as("script event thread finished").isFalse();
        assertThat(deactivation.isAlive()).as("deactivation thread finished").isFalse();
        assertThat(failure.get()).isNull();
        verify(restored).unregister();
    }

    @Test
    public void shouldIgnoreModifiedScript() throws ScriptException {
        service.scriptChanged(event(ScriptEvent.MODIFIED));

        verifyRegistrations(1);
        verify(registration, times(0)).unregister();
    }

    /**
     * Waits until the thread is blocked on a monitor owned by the other thread.
     */
    private static boolean waitForLockOwnedBy(Thread thread, Thread owner) {
        ThreadMXBean threads = ManagementFactory.getThreadMXBean();
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
        while (System.nanoTime() < deadline && thread.isAlive()) {
            ThreadInfo info = threads.getThreadInfo(thread.getId());
            if (info != null && info.getThreadState() == Thread.State.BLOCKED
                    && info.getLockOwnerId() == owner.getId()) {
                return true;
            }
            Thread.yield();
        }
        return false;
    }

    private ScriptEvent event(int type) {
        return new ScriptEvent(type, scriptRegistry, scriptName);
    }

    private List<RequestHandler> verifyRegistrations(int count) {
        ArgumentCaptor<RequestHandler> handlers = ArgumentCaptor.forClass(RequestHandler.class);
        verify(bundleContext, times(count)).registerService(eq(RequestHandler.class), handlers.capture(),
                ArgumentMatchers.<Dictionary<String, ?>>any());
        return handlers.getAllValues();
    }

    private static class TestScriptedService extends AbstractScriptedService {

        private final BundleContext bundleContext;
        private final ScriptRegistry scriptRegistry;

        TestScriptedService(BundleContext bundleContext, ScriptRegistry scriptRegistry) {
            this.bundleContext = bundleContext;
            this.scriptRegistry = scriptRegistry;
        }

        @Override
        protected BundleContext getBundleContext() {
            return bundleContext;
        }

        @Override
        protected ScriptRegistry getScriptRegistry() {
            return scriptRegistry;
        }
    }
}
