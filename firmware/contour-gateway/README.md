# SanteTrace ESP32 glucose gateway

Firmware source and build instructions: [IoT setup guide](../../docs/iot-contour-gateway.md).

This is an implementation of the **standard Bluetooth Glucose Service**, not a claim that a physical Contour Next One has been connected or that its radio profile has been verified. It posts to SanteTrace's existing authenticated connector API; it does not require Supabase.

Build:

```sh
python3 -m venv .tools/venv
.tools/venv/bin/pip install platformio==6.1.18
.tools/venv/bin/pio run -j 2
clang++ -std=c++17 -Wall -Wextra -Werror -pedantic -fsanitize=address,undefined -I include tests/decoder_test.cpp -o tests/decoder-test
tests/decoder-test
clang++ -std=c++17 -Wall -Wextra -Werror -pedantic -fsanitize=address,undefined -pthread -I include tests/transport_test.cpp -o tests/transport-test
tests/transport-test
```

Do not flash a board's filesystem if it contains pending readings. Local credential files, tools, binaries and build logs are ignored by this directory's `.gitignore`.
