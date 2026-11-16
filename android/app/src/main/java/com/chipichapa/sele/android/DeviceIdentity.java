package com.chipichapa.sele.android;

import java.nio.charset.StandardCharsets;
import java.util.UUID;

final class DeviceIdentity {
    private DeviceIdentity() {}

    static String resolve(String androidId, String savedId) {
        if (androidId != null && !androidId.isEmpty()) {
            // Android scopes this value to the app signing key, user and device.
            return UUID.nameUUIDFromBytes(("sele-device:" + androidId).getBytes(StandardCharsets.UTF_8)).toString();
        }
        return savedId != null ? savedId : UUID.randomUUID().toString();
    }
}
