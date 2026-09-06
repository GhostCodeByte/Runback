package com.runback.integrations

import android.app.Activity
import android.os.Bundle
import android.graphics.Color
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Button

class HealthRationaleActivity : Activity() {
    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        val padding = (24 * resources.displayMetrics.density).toInt()
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setPadding(padding,padding*2,padding,padding)
            setBackgroundColor(Color.rgb(16,18,16))
        }
        layout.addView(TextView(this).apply {text="Daten in Health Connect";textSize=24f;setTextColor(Color.WHITE)})
        layout.addView(TextView(this).apply {
            text="Runback liest nur freigegebene Trainings- und Kontextdaten für deine lokale Laufanalyse. Fertige Runback-Läufe werden nur auf deinen Wunsch geschrieben. Die Route ist separat wählbar.\n\nDie Runback-Datenbank bleibt auf diesem Gerät. Andere Apps können eigene Cloud-Funktionen verwenden. Freigaben lassen sich jederzeit in Health Connect widerrufen.\n\nOhne Health Connect funktioniert die Laufaufzeichnung weiter."
            textSize=17f;setTextColor(Color.rgb(230,235,230));setPadding(0,padding,0,padding)
        })
        layout.addView(Button(this).apply {text="Schließen";setOnClickListener {finish()}})
        setContentView(layout)
    }
}
