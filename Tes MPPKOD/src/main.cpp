#include <Arduino.h>

// Definisi Pin GPIO ESP32
const int pinTrig = 2;     // Pin Trig HC-SR04
const int pinEcho = 13;    // Pin Echo HC-SR04 
const int pinLED = 22;     // Pin LED Merah
const int pinBuzzer = 15;  // Pin Signal Buzzer

// Batas jarak deteksi (cm)
const int batasJarak = 40;

// Set true kalau mau lihat jarak di Serial Monitor (JANGAN true saat Python jalan)
const bool DEBUG_SERIAL = false;

// Status alarm
bool alarmKamera = false;   // diatur dari Python ('1' / '0')
bool alarmJarak = false;    // diatur dari ultrasonik

unsigned long waktuUkurTerakhir = 0;
const unsigned long intervalUkur = 100;   // ms

// Deklarasi fungsi
long ukurJarak();
void setAlarm(bool aktif);

void setup() {
  Serial.begin(115200);

  pinMode(pinTrig, OUTPUT);
  pinMode(pinEcho, INPUT);
  pinMode(pinLED, OUTPUT);
  pinMode(pinBuzzer, OUTPUT);

  setAlarm(false);

  if (DEBUG_SERIAL) Serial.println("Sistem Pendeteksi Siap!");
}

void loop() {
  // 1. Baca perintah dari Python (kamera)
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '1') alarmKamera = true;
    else if (c == '0') alarmKamera = false;
  }

  // 2. Ukur jarak tiap 100 ms (tanpa delay)
  if (millis() - waktuUkurTerakhir >= intervalUkur) {
    waktuUkurTerakhir = millis();
    long jarak = ukurJarak();

    alarmJarak = (jarak > 0 && jarak <= batasJarak);

    if (DEBUG_SERIAL) {
      Serial.printf("Jarak Objek: %ld cm\n", jarak);
      if (alarmJarak) Serial.println("WARNING: Objek Terlalu Dekat! [Alarm Aktif]");
    }
  }

  // 3. Output
  if (alarmKamera) {
    // Kepala menoleh: nyala terus
    setAlarm(true);
  } else if (alarmJarak) {
    // Objek terlalu dekat: kedip cepat 100 ms
    setAlarm((millis() / 100) % 2 == 0);
  } else {
    setAlarm(false);
  }
}

// Mengukur jarak dengan HC-SR04
long ukurJarak() {
  digitalWrite(pinTrig, LOW);
  delayMicroseconds(2);
  digitalWrite(pinTrig, HIGH);
  delayMicroseconds(10);
  digitalWrite(pinTrig, LOW);

  long durasi = pulseIn(pinEcho, HIGH, 30000);   // timeout 30 ms
  long jarak = durasi * 0.0343 / 2;
  return jarak;                                  // 0 kalau tidak ada pantulan
}

// Nyalakan / matikan LED + Buzzer sekaligus
void setAlarm(bool aktif) {
  digitalWrite(pinLED, aktif);
  digitalWrite(pinBuzzer, aktif);
}