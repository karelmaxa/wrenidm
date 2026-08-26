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
 * Portions Copyright 2026 Wren Security.
 */

/**
 * Module which computes and maintains "inherited" role grants on a managed object. An inherited grant is a role
 * grant (marked with `_refProperties._grantType === 'inherited'`) that the object receives because a related
 * object - referenced through one of the object's relationship properties, e.g. `position` or `organization` -
 * itself has that role.
 *
 * {@link updateInheritedGrants} recalculates those grants whenever the object itself is created or updated, and
 * {@link notifyRoleChange} propagates a role change on the object to every related object which may have inherited
 * a grant from it, by triggering a sync check on each of them.
 */
(function () {
    const _ = require('lib/lodash');

    /**
     * Recalculates the `roles` property of the given object, replacing any previously-computed inherited grants
     * with a fresh set derived from the roles of the objects referenced by `referencePropNames`. Grants that are
     * not inherited (direct or conditional grants) are left untouched.
     *
     * Call this from the object's `onCreate` and `onUpdate` scripts, e.g. in managed.json:
     * <pre>
     * "onCreate" : {
     *     "type" : "text/javascript",
     *     "source" : "require('roles/inheritedRoles').updateInheritedGrants(object, resourceName.toString(), ['position']);"
     * },
     * "onUpdate" : {
     *     "type" : "text/javascript",
     *     "source" : "require('roles/inheritedRoles').updateInheritedGrants(object, resourceName.toString(), ['position']);"
     * },
     * "onStore" : {
     *     "type" : "text/javascript",
     *     "source" : "delete object.$force"
     * }
     * </pre>
     *
     * @param object the object being created or updated; its `roles` property is replaced, in-place, with the
     * recalculated set of grants
     * @param resourceName the managed resource path of `object` (e.g. `managed/user/bjensen`), bound by the
     * onCreate/onUpdate script scope; used as a fallback to read a relationship property from the repository when
     * it is not (yet) present on `object`
     * @param referencePropNames names of the relationship properties on `object` whose referenced objects' roles
     * should be inherited (e.g. `['position', 'organization']`)
     */
    exports.updateInheritedGrants = function(object, resourceName, referencePropNames) {
        const referenceIds = resolveReferenceIds(object, resourceName, referencePropNames);
        const inheritedGrants = _(referenceIds)
            .map(referenceId => readResourceRoles(referenceId))
            .flatten()
            .uniqBy('_ref')
            .map(roleRef => ({ _ref: roleRef._ref, _refProperties: { _grantType: 'inherited' } }))
            .value();

        const otherGrants = (object.roles || readResourceRoles(resourceName)).filter(
            grant => !grant._refProperties || grant._refProperties._grantType !== 'inherited');

        object.roles = [].concat(otherGrants).concat(inheritedGrants).sort((a, b) => a._ref.localeCompare(b._ref));
    };

    /**
     * Detects whether this object's own `roles`, or any of its relationship properties named in
     * `referencePropNames`, changed as a result of the update that is being synced, and if so triggers a sync
     * check (with forced role recalculation) on every object which may need to recompute its inherited grants as a
     * consequence:
     * - if `roles` changed, every object currently referenced by `referencePropNames` is re-checked, since any of
     *   them could be inheriting from this object;
     * - if a relationship property itself changed (e.g. the manager was reassigned), only the objects that were
     *   added to, or removed from, that relationship are re-checked.
     *
     * Call this from the object's `onSync` script, e.g. in managed.json:
     * <pre>
     * "onSync" : {
     *     "type" : "text/javascript",
     *     "source" : "require('roles/inheritedRoles').notifyRoleChange(resourceName.toString(), oldObject, newObject, ['position']);"
     * }
     * </pre>
     *
     * @param resourceName the managed resource path of the object being synced, bound by the onSync script scope
     * @param oldObject the object's state prior to the change being synced, bound by the onSync script scope;
     * `undefined` when the object is being created, in which case sync is triggered for all of its current
     * references
     * @param newObject the object's state after the change being synced, bound by the onSync script scope; used
     * to resolve current references when `oldObject` is `undefined` (i.e. on create)
     * @param referencePropNames names of the relationship properties on the object which other objects may use as
     * a source of inherited grants (e.g. `['position', 'organization']`)
     */
    exports.notifyRoleChange = function(resourceName, oldObject, newObject, referencePropNames) {
        if (!oldObject || !newObject) {
            // Trigger sync for all references during CREATE / DELETE operation
            syncReferences(resolveReferenceIds(oldObject ? oldObject : newObject, resourceName, referencePropNames));
            return;
        }

        // Fetch current state of relationship fields (newObject does not contain it)
        const storedValue = openidm.read(resourceName, { executeOnRetrieve: false }, ['roles'].concat(referencePropNames));

        if (isReferenceChange(oldObject.roles, storedValue.roles)) {
            // Trigger sync for all references
            syncReferences(resolveReferenceIds(storedValue, resourceName, referencePropNames));
        }

        referencePropNames.forEach(propName => {
            if (isReferenceChange(oldObject[propName], storedValue[propName])) {
                let oldReferenceIds = oldObject[propName] ? resolveReferenceIds(oldObject, resourceName, [propName]) : [];
                let newReferenceIds = resolveReferenceIds(storedValue, resourceName, [propName]);
                syncReferences(_.xor(oldReferenceIds, newReferenceIds));
            }
        });
    };

    /**
     * Resolves the set of resource paths (e.g. `managed/position/foobar`) referenced by the given relationship
     * properties on `object`. Single-valued and multi-valued (array) relationship properties are both supported.
     *
     * @param object the object to read the relationship properties from
     * @param resourceName the managed resource path of `object`; used to read a relationship property from the
     * repository when it is not present on `object` (ignored if `resourceName` is not given)
     * @param referencePropNames names of the relationship properties to resolve; returns `[]` if not given
     * @returns {Array} the de-duplicated `_ref` resource paths referenced by `referencePropNames`
     */
    function resolveReferenceIds(object, resourceName, referencePropNames) {
        if (!referencePropNames) {
            return [];
        }

        // Fetch missing properties
        const missingProps = resourceName ? referencePropNames.filter(propName => !object[propName]) : [];
        const storedObject = missingProps.length ? openidm.read(resourceName, { executeOnRetrieve: false }, missingProps) : {};

        return _(referencePropNames)
            .map(propName => {
                const reference = object[propName] || _.get(storedObject, propName);
                if (isArray(reference)) {
                    return reference.map(ref => ref._ref);
                }
                return reference ? [reference._ref] : [];
            })
            .flatten()
            .compact()
            .uniq()
            .value();
    }

    /**
     * Reads the current role relationships of the given resource.
     *
     * @param resourcePath the managed resource path to read the roles of (e.g. `managed/user/bjensen`)
     * @returns {Array} the resource's role relationship entries, or `[]` if `resourcePath` is not given
     */
    function readResourceRoles(resourcePath) {
        if (!resourcePath) {
            return [];
        }
        return openidm.query(`${resourcePath}/roles`, { _queryId: 'find-relationships-for-resource' }).result || [];
    }

    /**
     * Determines whether a relationship property's value (single reference or array of references) changed,
     * ignoring the order of entries in an array.
     *
     * @param oldValue the property's previous value, or `undefined` if it was not fetched (e.g. a patch operation
     * that did not touch the relationship field)
     * @param newValue the property's current value
     * @returns {boolean} true if the set of referenced `_ref` values differs between `oldValue` and `newValue`;
     * false if they are the same, or if `oldValue` is `undefined`
     */
    function isReferenceChange(oldValue, newValue) {
        if (oldValue === undefined) {
            return false; // Ignore patch operation when relationship has not been fetched
        }
        const oldRefs = isArray(oldValue) ? oldValue : [oldValue];
        const newRefs = isArray(newValue) ? newValue : [newValue];
        return !_.isEqual(_.sortBy(oldRefs, ['_ref']), _.sortBy(newRefs, ['_ref']));
    }

    /**
     * Triggers recalculation of inherited grants on each of the given resources by patching the transient
     * `$force` property on them.
     *
     * @param refs the resource paths to recalculate inherited grants on (e.g. `['managed/user/bjensen']`)
     */
    function syncReferences(refs) {
        refs.forEach(ref => openidm.patch(ref, null, [{ operation: 'replace', field: '/$force', value: true }]));
    }

    /**
     * Determines whether the given value is a JavaScript array, whether it was created in this script engine or
     * passed in from Java-backed script bindings (e.g. relationship arrays returned by `openidm.read`).
     *
     * @param value the value to check
     * @returns {boolean} true if `value` is an array
     */
    function isArray(value) {
        return Array.isArray(value) || value instanceof Array;
    }

}());
