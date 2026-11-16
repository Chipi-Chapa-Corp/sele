package com.chipichapa.sele.android;

import static org.junit.Assert.*;
import org.junit.Test;
import java.util.UUID;

public class DeviceIdentityTest {
    @Test public void clearingAppStoragePreservesIdentity() {
        String first = DeviceIdentity.resolve("0123456789abcdef", "old-install-id");
        assertEquals(first, DeviceIdentity.resolve("0123456789abcdef", null));
        assertEquals(first, UUID.fromString(first).toString());
        assertNotEquals(first, DeviceIdentity.resolve("fedcba9876543210", null));
    }

    @Test public void unavailableAndroidIdKeepsSavedFallback() {
        String first = DeviceIdentity.resolve(null, null);
        assertEquals(first, DeviceIdentity.resolve(null, first));
        assertEquals(first, DeviceIdentity.resolve("", first));
    }
}
