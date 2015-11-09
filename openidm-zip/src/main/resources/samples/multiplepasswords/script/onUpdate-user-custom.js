/*
 * The contents of this file are subject to the terms of the Common Development and
 * Distribution License (the License). You may not use this file except in compliance with the
 * License.
 *
 * You can obtain a copy of the License at legal/CDDLv1.0.txt. See the License for the
 * specific language governing permission and limitations under the License.
 *
 * When distributing Covered Software, include this CDDL Header Notice in each file and include
 * the License file at legal/CDDLv1.0.txt. If applicable, add the following below the CDDL
 * Header, with the fields enclosed by brackets [] replaced by your own identifying
 * information: "Portions copyright [year] [name of copyright owner]".
 *
 * Copyright 2015 ForgeRock AS.
 */

/*global newObject, oldObject */
var cipher = "AES/CBC/PKCS5Padding",
    alias = identityServer.getProperty("openidm.config.crypto.alias", "true", true);

for (var index in historyFields) {
    var matchHashed, newValue, oldValue, field = historyFields[index];
    
    // Read in the old field history
    object.fieldHistory = oldObject.fieldHistory;
    
    // Decrypt the field history array
    if (openidm.isEncrypted(object.fieldHistory[field])) {
        object.fieldHistory[field] = openidm.decrypt(object.fieldHistory[field]);
    }

    // Create the new history array if it doesn't already exist
    if (typeof object.fieldHistory[field] === "undefined") {
        object.fieldHistory[field] = new Array(historySize);
    }

    // Get decrypted new and old field values
    newValue = openidm.isEncrypted(object[field]) ? openidm.decrypt(object[field]) : object[field];
    oldValue = openidm.isEncrypted(oldObject[field]) ? openidm.decrypt(oldObject[field]) : oldObject[field];
    
    // Determine if a plain text value needs to be compared to a hashed value
    matchHashed = openidm.isHashed(oldValue) && !openidm.isHashed(newValue);
    
    // Check if the new and old values are different
    if ((matchHashed && !openidm.matches(newValue, oldValue)) 
            || (!matchHashed && JSON.stringify(newValue) !== JSON.stringify(oldValue))) {
        // The values are different, so store then new value.
        object.fieldHistory[field].shift();
        object.fieldHistory[field].push(object[field]);
    }

    // Encrypt the field history array
    object.fieldHistory[field] = openidm.encrypt(object.fieldHistory[field], cipher, alias);
}