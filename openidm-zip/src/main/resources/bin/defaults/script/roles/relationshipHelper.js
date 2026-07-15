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
 * Copyright 2016 ForgeRock AS.
 * Portions Copyright 2026 Wren Security.
 */

/**
 * A module which defines some utility functions used to evaluate conditional roles.
 */
(function () {

    /**
     * Returns the grants of either the managed role or user
     * @param managedObject the user or role
     * @param grantFieldName the name of the collection referencing grants
     * @param managedObjectType the type of managedObject - either 'user' or 'role'
     * @returns {*} the members of the managedObject members array specified in the managedObject, or, if this array is not present,
     * the result of the relationship query against this particular managedObject.
     */
    exports.getGrants = function(managedObject, grantFieldName, managedObjectType) {
        if (managedObject[grantFieldName]) {
            return managedObject[grantFieldName];
        }
        if (!managedObject._id) {
            return [];
        }
        logger.trace("Managed Objects's membership collection {} is not present so querying the relationship", grantFieldName);
        const path = org.forgerock.json.resource.ResourcePath.valueOf('managed/' + managedObjectType)
            .child(managedObject._id).child(grantFieldName).toString();
        return openidm.query(path, { _queryId: 'find-relationships-for-resource' }).result;
    }

    /**
     * TODO FIXME
     */
    exports.isGrantType = function(grant, type) {
        return grant && grant._refProperties && grant._refProperties._grantType === type;
    }

    /**
     * TODO FIXME
     */
    exports.sortGrants = function(grants) {
        return grants.sort((a, b) => a._ref.localeCompare(b._ref));
    }
}());