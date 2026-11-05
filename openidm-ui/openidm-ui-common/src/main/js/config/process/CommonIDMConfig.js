/**
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
 * Copyright 2014-2016 ForgeRock AS.
 * Portions Copyright 2023-2026 Wren Security.
 */

define([
    "jquery",
    "lodash",
    "org/forgerock/openidm/ui/common/util/Constants",
    "org/forgerock/commons/ui/common/components/Messages"
], function($, _, constants, messagesManager) {
    var ignorePassword = false,
        obj = [
            {
                startEvent: constants.EVENT_POLICY_FAILURE,
                description: "Failure to save record due to policy validation",
                dependencies: [ ],
                processDescription: function(event) {
                    var response = event.error.responseObj,
                        failedProperties,
                        errors = "Unknown";

                    if (typeof response === "object" && response !== null &&
                        typeof response.detail === "object" && (response.message === "Failed policy validation" || response.message === "Policy validation failed")) {

                        errors = _.chain(response.detail.failedPolicyRequirements)
                            .groupBy('property')
                            .toPairs()
                            .map(function (a) {
                                return " - " + _.escape(a[0]) + ": " +
                                            _.chain(a[1])
                                                .map('policyRequirements')
                                                .map(function (pr) {
                                                    return _.map(pr, function (p) {
                                                        return _.escape($.t("common.form.validation." + p.policyRequirement,
                                                            _.extend({}, p.params, { interpolation: { escapeValue: false } })));
                                                    });
                                                })
                                                .value()
                                                .join(", ");
                            })
                            .value()
                            .join(" <br/> ");

                    }

                    // The message contains HTML line breaks; the dynamic parts are escaped above.
                    messagesManager.messages.addMessage({
                        type: "error",
                        message: $.t("config.messages.AdminMessages.resourceValidationError", {
                            validationErrors: errors,
                            interpolation: { escapeValue: false }
                        }),
                        escape: false
                    });
                }
            }
        ];

    return obj;
});
