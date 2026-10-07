cmake_minimum_required(VERSION 3.20)
set(PICO_BOARD waveshare_rp2350_usb_a CACHE STRING "Target board")
if(NOT PICO_BOARD STREQUAL "waveshare_rp2350_usb_a")
  message(FATAL_ERROR "The standalone prototype requires Waveshare RP2350-USB-A")
endif()
if(NOT PICO_SDK_PATH)
  set(PICO_SDK_PATH "$ENV{PICO_SDK_PATH}")
endif()
if(NOT PICO_PIO_USB_PATH)
  set(PICO_PIO_USB_PATH "$ENV{PICO_PIO_USB_PATH}" CACHE PATH "Pico-PIO-USB checkout")
endif()
include("${PICO_SDK_PATH}/external/pico_sdk_import.cmake")
project(ch552_programmer VERSION 0.3.2 LANGUAGES C CXX ASM)
set(CMAKE_C_STANDARD 11)
pico_sdk_init()
# Keep both persistent drive snapshots outside the application's linkable flash.
add_executable(ch552_programmer main.c programmer.c board_status.c image_drive.c
  drive_store.c firmware_drive.c ../firmware/probe_protocol.c usb_descriptors.c)
math(EXPR PROGRAMMER_FLASH_BYTES "2 * 1024 * 1024 - 2 * (256 * 1024 + 4096)")
# Limit only the linker region. pico_override_flash_size() also changes the
# physical chip size used by hardware_flash, which would reject storage writes.
set(PROGRAMMER_LINKER_DIR "${CMAKE_CURRENT_BINARY_DIR}/programmer-linker")
file(MAKE_DIRECTORY "${PROGRAMMER_LINKER_DIR}")
file(WRITE "${PROGRAMMER_LINKER_DIR}/pico_flash_region.ld"
  "FLASH(rx) : ORIGIN = 0x10000000, LENGTH = ${PROGRAMMER_FLASH_BYTES}\n")
pico_add_linker_script_override_path(ch552_programmer "${PROGRAMMER_LINKER_DIR}" FILES pico_flash_region.ld)
target_include_directories(ch552_programmer PRIVATE "${CMAKE_CURRENT_LIST_DIR}"
  "${CMAKE_CURRENT_LIST_DIR}/../firmware" "${CMAKE_CURRENT_BINARY_DIR}")
target_compile_definitions(ch552_programmer PRIVATE
  PROGRAMMER_APP_FLASH_BYTES=${PROGRAMMER_FLASH_BYTES}
  PROBE_VERSION="${PROJECT_VERSION}-standalone" PIO_USB_DP_PIN_DEFAULT=12 PICO_STACK_SIZE=0x1000 PICO_FLASH_ASSUME_CORE1_SAFE=1)
target_compile_options(ch552_programmer PRIVATE -Wall -Wextra -Werror)
target_link_libraries(ch552_programmer PRIVATE pico_stdlib pico_unique_id hardware_watchdog
  hardware_pio hardware_flash pico_flash tinyusb_device tinyusb_host tinyusb_pico_pio_usb)
pico_generate_pio_header(ch552_programmer "${PICO_SDK_PATH}/src/rp2_common/pico_status_led/ws2812.pio")
pico_enable_stdio_uart(ch552_programmer 0)
pico_enable_stdio_usb(ch552_programmer 0)
pico_set_program_name(ch552_programmer "CH552 Macropad Programmer")
pico_set_program_version(ch552_programmer "${PROJECT_VERSION}-standalone")
pico_add_extra_outputs(ch552_programmer)
