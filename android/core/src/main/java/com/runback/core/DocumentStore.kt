package com.runback.core

import org.json.JSONObject

/** Small document seam for durable native coordination state and its deterministic tests. */
interface DocumentStore {
    fun getDocument(key: String): JSONObject?
    fun putDocument(key: String, value: JSONObject)
    fun deleteDocument(key: String)
}
