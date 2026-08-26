define([
    "org/forgerock/openidm/ui/admin/role/MembersView",
    "jquery"
], function (MembersView, $) {
    //this is a table with 4 data rows, 2 of which are conditional and 1 of which is inherited
    var membersListHTML = '<table>' +
    '<tr><td class="select-row-cell"><input type="checkbox"></td><td class="_grantType">conditional</td></tr>' +
    '<tr><td class="select-row-cell"><input type="checkbox"></td><td class="_grantType">conditional</td></tr>' +
    '<tr><td class="select-row-cell"><input type="checkbox"></td><td class="_grantType">inherited</td></tr>' +
    '<tr><td class="select-row-cell"><input type="checkbox"></td><td class="_grantType"></td></tr>' +
    '</table>';

    QUnit.module('MembersView Tests');

    QUnit.test("Checkboxes on grid rows that have _grantType = 'conditional' or 'inherited' have been removed", function (assert) {
        var membersList = $(membersListHTML),
            checkboxesBefore = membersList.find("td.select-row-cell input:checkbox"),
            checkboxesAfter;


        assert.equal(checkboxesBefore.length, 4, "Correct number of checkboxes are displayed before removing the ones for conditional/inherited grants");

        MembersView.removeDerivedGrantCheckboxes(membersList);

        checkboxesAfter = membersList.find("td.select-row-cell input:checkbox");

        assert.equal(checkboxesAfter.length, 1, "Correct number of checkboxes are displayed after removing the ones for conditional/inherited grants");
    });

});
