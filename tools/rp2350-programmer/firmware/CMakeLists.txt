cmake_minimum_required(VERSION 3.20)

set(PICO_BOARD waveshare_rp2350_usb_a CACHE STRING "Target board")
if(NOT PICO_BOARD STREQUAL "waveshare_rp2350_usb_a")
  message(FATAL_ERROR "This prototype is wired for the Waveshare RP2350-USB-A only")
endif()
if(NOT PICO_SDK_PATH)
  set(PICO_SDK_PATH "$ENV{PICO_SDK_PATH}")
endif()
if(NOT PICO_PIO_USB_PATH)
  set(PICO_PIO_USB_PATH "$ENV{PICO_PIO_USB_PATH}" CACHE PATH "Pico-PIO-USB checkout")
endif()
if(NOT EXISTS "${PICO_SDK_PATH}/pico_sdk_init.cmake" OR
   NOT EXISTS "${PICO_PIO_USB_PATH}/src/pio_usb.c")
  message(FATAL_ERROR "Set PICO_SDK_PATH and PICO_PIO_USB_PATH; see ../usage.md")
endif()

include("${PICO_SDK_PATH}/external/pico_sdk_import.cmake")
project(ch552_probe VERSION 0.1.6 LANGUAGES C CXX ASM)
set(CMAKE_C_STANDARD 11)
pico_sdk_init()
if(NOT TARGET tinyusb_pico_pio_usb)
  message(FATAL_ERROR "TinyUSB or Pico-PIO-USB is missing; initialize SDK lib/tinyusb")
endif()

add_executable(ch552_probe main.c usb_descriptors.c probe_protocol.c)
target_include_directories(ch552_probe PRIVATE ${CMAKE_CURRENT_LIST_DIR})
target_compile_definitions(ch552_probe PRIVATE
  PROBE_VERSION="${PROJECT_VERSION}"
  PIO_USB_DP_PIN_DEFAULT=12
  PICO_STACK_SIZE=0x1000
)
target_compile_options(ch552_probe PRIVATE -Wall -Wextra)
target_link_libraries(ch552_probe PRIVATE pico_stdlib pico_unique_id pico_rand hardware_watchdog
  tinyusb_device tinyusb_host tinyusb_pico_pio_usb)
pico_enable_stdio_uart(ch552_probe 0)
pico_enable_stdio_usb(ch552_probe 0)
pico_set_program_name(ch552_probe "CH552 read-only probe")
pico_set_program_version(ch552_probe ${PROJECT_VERSION})
pico_add_extra_outputs(ch552_probe)
