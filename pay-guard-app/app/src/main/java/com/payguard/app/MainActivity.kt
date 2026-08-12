package com.payguard.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.payguard.app.ui.theme.PayGuardTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            PayGuardTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    Welcome()
                }
            }
        }
    }
}

@Composable
private fun Welcome() {
    Column(modifier = Modifier.padding(24.dp)) {
        Text("Pay Guard", style = MaterialTheme.typography.headlineLarge)
        Text("The Android foundation is ready for the product specification.")
    }
}
