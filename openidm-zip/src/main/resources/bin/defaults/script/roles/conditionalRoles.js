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
 * Module which updates conditional role grants for created/updated users/roles. Note that existing grants should
 * be preserved across any changes - change logic should only add-to/remove existing grants. And this logic works
 * by modifying the members array of the role, or the roles array of the user - it does not invoke openidm to mutate roles.
 */
(function () {
    const _ = require('lib/lodash');
    const relationshipHelper = require('roles/relationshipHelper');

    /**
     * This function will be called for the onCreate and onUpdate triggers for managed users. It must determine which
     * conditional role grants will be preserved/applied-to/removed-from the given user.
     * @param user the newly-created, or updated, user
     * @param rolesPropName the name of the array in the user referencing the user's roles
     */
    exports.updateConditionalGrantsForUser = function(user, rolesPropName) {
        const userRoleGrants = relationshipHelper.getGrants(user, rolesPropName, 'user');
        const existingConditionalRoles = openidm.query('managed/role', { _queryFilter: '/condition pr' }).result;
        this.evaluateConditionalRoles(user, rolesPropName, existingConditionalRoles, userRoleGrants);
    };

    /**
     * This function will be called for the onCreate and onUpdate triggers for managed users. It will mutate the current
     * set of user role grants in the following manner:
     * 1. add existing direct grants
     * 2. iterate through the existingConditionalRoles, and add the grant if this grant is not already enjoyed by the user
     * and if the condition is satisfied.
     * 3. filter the existing conditional grants by removing those which do not satisfy the condition.
     * @param user the newly-created, or updated, user
     * @param rolesPropName the name of the array referencing the roles in the user object
     * @param existingConditionalRoles the current set of conditional roles in the system
     * @param userRoleGrants the current role grants for the user.
     */
    exports.evaluateConditionalRoles = function(user, rolesPropName, existingConditionalRoles, userRoleGrants) {
        const conditionalGrants = userRoleGrants.filter(grant => relationshipHelper.isGrantType(grant, 'conditional'));
        const otherGrants = userRoleGrants.filter(grant => !relationshipHelper.isGrantType(grant, 'conditional'));

        const conditionalGrantRefs = (conditionalGrants || []).map(grant => grant._ref);
        const otherGrantRefs = (otherGrants || []).map(grant => grant._ref);

        const result = otherGrants;

        // Add conditional roles that are not assigned yet
        existingConditionalRoles.filter(role => {
            const roleRef = 'managed/role/' + role._id;
            // Check that role is not already granted
            if (conditionalGrantRefs.includes(roleRef) || otherGrantRefs.includes(roleRef)) {
                return false;
            }
            // Check if the role condition applies to the specified user
            return org.forgerock.openidm.condition.Conditions.newCondition(role.condition).evaluate(user, null);
        }).forEach(role => {
            result.push({
                _ref: 'managed/role/' + role._id,
                _refProperties: { _grantType: 'conditional' },
            });
        });

        // Retain existing conditional grants that are still valid
        conditionalGrants.filter(grant => {
            const role = existingConditionalRoles.find(role => 'managed/role/' + role._id === grant._ref);
            // Ignore grant for role that is not conditional role anymore
            if (!role) {
                return false;
            }
            // Check if the role condition still applies to the specified user
            return org.forgerock.openidm.condition.Conditions.newCondition(role.condition).evaluate(user, null);
        }).forEach(grant => {
            result.push(grant);
        });

        user[rolesPropName] = relationshipHelper.sortGrants(result);
    }

    /**
     * Invoked when a role is created. This function will update the members array with user references which enjoy the
     * role.
     * @param newRole the newly-created role
     */
    exports.roleCreate = function(newRole) {
        /**
         * If the newRoles is attempting to update an oldRole with an array of temporalConstraints greater than 1 throw
         * BadRequestException. As the implementation stands now, we only support one temporal constraint per role.
         */
        if (isTemporalConstraintsMultiValue(newRole)) {
            throw {code : 400, message: "Only 1 temporal constraint is supported per role."}
        }
        if (isRoleConditional(newRole)) {
            newRole.members = resolveConditionalRoleMembers(newRole);
        }
    }

    /**
     * This function will be called on onUpdate for roles. The logic below will update any conditional role
     * grant changes resulting from the conditional role change.
     * @param oldRole the previous role
     * @param newRole the updated role
     */
    exports.roleUpdate = function(oldRole, newRole) {
        /**
         * If the newRoles is attempting to update an oldRole with an array of temporalConstraints greater than 1 throw
         * BadRequestException. As the implementation stands now, we only support one temporal constraint per role.
         */
        if (isTemporalConstraintsMultiValue(newRole)) {
            throw {code : 400, message: "Only 1 temporal constraint is supported per role."}
        }
        /*
         Only iterate through all of the users if we are dealing with a conditional role, and if the
         role condition has changed. And if the role's condition has been removed, the new role grantees will be only
         those members who previously enjoyed a direct grant.
         */
        if (isRoleConditional(newRole) && !_.isEqual(oldRole.condition, newRole.condition)) {
            newRole.members = resolveConditionalRoleMembers(newRole);
        } else if (isRoleConditional(oldRole) && !isRoleConditional(newRole)) {
            newRole.members = relationshipHelper.sortGrants(relationshipHelper.getGrants(oldRole, 'members', 'role')
                .filter(grant => !relationshipHelper.isGrantType(grant, 'conditional')));
        }
    }

    /**
     * TODO FIXME
     */
    function resolveConditionalRoleMembers(role) {
        const existingGrants = relationshipHelper.getGrants(role, 'members', 'role');

        const otherGrants = existingGrants.filter(grant => !relationshipHelper.isGrantType(grant, 'conditional'));
        const otherGrantRefs = (otherGrants || []).map(grant => grant._ref);

        const conditionalGrants = searchUserIds(role.condition).filter(userId => {
            return !otherGrantRefs.includes('managed/user/' + userId);
        }).map(userId => {
            return {
                _ref: 'managed/user/' + userId,
                _refProperties: { _grantType : 'conditional' },
            };
        });
        return relationshipHelper.sortGrants([].concat(otherGrants).concat(conditionalGrants));
    }

    /**
     * Determines if a role has more than one temporal constraint.
    *
    * @param role the role to inspect
    * @returns {boolean} true if temporal contraints array, inside of the role object, has a size greater than 1
    */
   function isTemporalConstraintsMultiValue(role) {
        return role.temporalConstraints && role.temporalConstraints.length > 1;
    }

    exports.isTemporalConstraintsMultiValue = isTemporalConstraintsMultiValue;

    /**
     * TODO FIXME
     */
    function searchUserIds(filter) {
        const result = [];
        let pagedResultsCookie = '';
        do {
            let queryResult = openidm.query('managed/user', {
                _queryFilter: filter,
                _pageSize: 500,
                _pagedResultsCookie: pagedResultsCookie,
                _fields: ['_id'],
            });
            result.concat(queryResult.result);
            pagedResultsCookie = queryResult.pagedResultsCookie;
        } while (pagedResultsCookie);
        return result;
    }

    /**
     * TODO FIXME
     */
    function isRoleConditional(role) {
        return role && role.condition !== undefined;
    }
}());