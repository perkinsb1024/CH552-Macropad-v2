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
project(ch552_programmer VERSION 0.2.2 LANGUAGES C CXX ASM)
set(CMAKE_C_STANDARD 11)
pico_sdk_init()
find_package(Python3 REQUIRED COMPONENTS Interpreter)

# Consume the existing release; never generate or modify releases/ here.
get_filename_component(REPO_ROOT "${CMAKE_CURRENT_LIST_DIR}/../../.." ABSOLUTE)
file(GLOB THREE_KEY_HEX CONFIGURE_DEPENDS "${REPO_ROOT}/releases/ch552-macropad-3-key-*.hex")
list(LENGTH THREE_KEY_HEX HEX_COUNT)
if(NOT HEX_COUNT EQUAL 1)
  message(FATAL_ERROR "Expected exactly one checked-in three-key HEX in releases/")
endif()
set(IMAGE_HEADER "${CMAKE_CURRENT_BINARY_DIR}/embedded_image.h")
add_custom_command(OUTPUT "${IMAGE_HEADER}"
  BYPRODUCTS "${CMAKE_CURRENT_BINARY_DIR}/embedded_image.json"
  COMMAND "${Python3_EXECUTABLE}" "${CMAKE_CURRENT_LIST_DIR}/embed_image.py"
          "${THREE_KEY_HEX}" "${IMAGE_HEADER}"
  DEPENDS "${THREE_KEY_HEX}" "${CMAKE_CURRENT_LIST_DIR}/embed_image.py"
  VERBATIM)
add_executable(ch552_programmer main.c programmer.c board_status.c
  ../firmware/probe_protocol.c usb_descriptors.c "${IMAGE_HEADER}")
target_include_directories(ch552_programmer PRIVATE "${CMAKE_CURRENT_LIST_DIR}"
  "${CMAKE_CURRENT_LIST_DIR}/../firmware" "${CMAKE_CURRENT_BINARY_DIR}")
target_compile_definitions(ch552_programmer PRIVATE
  PROBE_VERSION="${PROJECT_VERSION}-standalone-3key" PIO_USB_DP_PIN_DEFAULT=12 PICO_STACK_SIZE=0x1000)
target_compile_options(ch552_programmer PRIVATE -Wall -Wextra -Werror)
target_link_libraries(ch552_programmer PRIVATE pico_stdlib pico_unique_id hardware_watchdog
  hardware_pio tinyusb_device tinyusb_host tinyusb_pico_pio_usb)
pico_generate_pio_header(ch552_programmer "${PICO_SDK_PATH}/src/rp2_common/pico_status_led/ws2812.pio")
pico_enable_stdio_uart(ch552_programmer 0)
pico_enable_stdio_usb(ch552_programmer 0)
pico_set_program_name(ch552_programmer "CH552 standalone 3-key programmer")
pico_set_program_version(ch552_programmer "${PROJECT_VERSION}-standalone-3key")
pico_add_extra_outputs(ch552_programmer)
