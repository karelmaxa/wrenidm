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
 * Copyright 2024 Wren Security.
 */
import { EditorView, basicSetup } from "codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { xml } from "@codemirror/lang-xml";
import { StreamLanguage } from "@codemirror/language";
import { groovy } from "@codemirror/legacy-modes/mode/groovy";
import { Compartment } from "@codemirror/state";

/**
 * @typedef {"groovy" | "javascript" | "xml"} SupportedLanguage
 */

/**
 * @typedef {Object} CodeMirrorOptions
 * @property {SupportedLanguage} mode - script language
 * @property {string} value - initial script content
 * @property {Function[]} updateCallbacks - array of callbacks to be called on editor update
 */

const resolveLanguage = (lang) => {
    if (lang === "groovy") {
        return StreamLanguage.define(groovy);
    }
    if (lang === "xml") {
        return xml();
    }
    return javascript();
};

export default function(parent, options) {
    const theme = EditorView.theme({
        "&": { border: "1px solid #dbdbdb" }
    });
    const languageConf = new Compartment();
    return new EditorView({
        parent,
        doc: options.value ?? "",
        extensions: [
            basicSetup,
            theme,
            EditorView.editable.of(false),
            languageConf.of(resolveLanguage(options.mode))
        ]
    });
}
