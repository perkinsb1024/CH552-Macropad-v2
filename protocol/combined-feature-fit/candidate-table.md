# Combined-Feature Candidate Measurements

Six-/three-key ordering throughout. RAM Fail includes native overlay allocation failures. Oversized images use a diagnostic link solely for measurement; only real-limit successes fit. The selected source preserves ordinary chord scan ordering. Earlier combined, hot-* and final scheduling prototypes are not adoption candidates.

| Candidate | Recipe or Parent | Flash | Free | Stack Reserve | PSEG | XSEG | Native Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| allocator | combined | 14531/14512 | -195/-176 | 100/103 | 102/102 | 420/405 | Over Flash Limit |
| baseline | - | 13951/13932 | 385/404 | 105/108 | 102/102 | 404/395 | Fits |
| binding-offset | combined | 14485/14466 | -149/-130 | 106/109 | 102/102 | 420/405 | Over Flash Limit |
| binding-offset+load-helper | combined | 14475/14456 | -139/-120 | 106/109 | 102/102 | 420/405 | Over Flash Limit |
| callee-all-getters | combined | 14521/14502 | -185/-166 | 100/103 | 102/102 | 420/405 | Over Flash Limit |
| callee-generation | combined | 14535/14516 | -199/-180 | 100/103 | 102/102 | 420/405 | Over Flash Limit |
| callee-layers | combined | 14521/14502 | -185/-166 | 100/103 | 102/102 | 420/405 | Over Flash Limit |
| callee-pending | combined | 14515/14496 | -179/-160 | 100/103 | 102/102 | 420/405 | Over Flash Limit |
| callee-startup | combined | 14535/14516 | -199/-180 | 100/103 | 102/102 | 420/405 | Over Flash Limit |
| callee-timed | combined | 14523/14504 | -187/-168 | 100/103 | 102/102 | 420/405 | Over Flash Limit |
| callee-timed-offset | combined | 14595/14576 | -259/-240 | 100/103 | 102/102 | 420/405 | Over Flash Limit |
| combined | combined | 14531/14512 | -195/-176 | 100/103 | 102/102 | 420/405 | Over Flash Limit |
| dispatch-helper | combined | 14523/14504 | -187/-168 | 100/103 | 102/102 | 420/405 | Over Flash Limit |
| event-parallel | combined | 14529/14510 | -193/-174 | 100/103 | 102/102 | 420/405 | Over Flash Limit |
| final | hot-r + cleanup/tests (superseded) | 14321/14300 | 15/36 | 102/105 | 108/108 | 410/395 | Fits |
| hot-a | binding-offset+load-helper+dispatch-helper+usb-data-queue+raw-pdata+callee-pending+callee-layers+callee-timed | 14353/14334 | -17/2 | 102/105 | 108/108 | 410/395 | Over Flash Limit |
| hot-b | binding-offset+load-helper+dispatch-helper+usb-data-queue+usb-data-clocks+callee-pending+callee-layers+callee-timed | 14353/14334 | -17/2 | 97/100 | 102/102 | 411/396 | Over Flash Limit |
| hot-c | binding-offset+load-helper+dispatch-helper+usb-data-queue+usb-data-idle+callee-pending+callee-layers+callee-timed | 14341/14322 | -5/14 | 99/102 | 102/102 | 413/398 | Over Flash Limit |
| hot-d | binding-offset+load-helper+dispatch-helper+usb-data-queue+usb-data-idle+raw-pdata+callee-pending+callee-layers+callee-timed | 14311/14292 | 25/44 | 98/101 | 108/108 | 406/391 | Fits |
| hot-e | hot-d+stack | 14347/14328 | -11/8 | 101/104 | 108/108 | 410/395 | Over Flash Limit |
| hot-f | hot-d+stack+binding-params | 14367/14348 | -31/-12 | 101/104 | 108/108 | 412/397 | Over Flash Limit |
| hot-g | hot-d+tap-external | 14317/14298 | 19/38 | 100/103 | 108/108 | 408/393 | Fits |
| hot-h | hot-d+tap-external+binding-params | 14339/14320 | -3/16 | 100/103 | 108/108 | 410/395 | Over Flash Limit |
| hot-i | hot-g+callee-binding-offset | 14347/14328 | -11/8 | 100/103 | 108/108 | 408/393 | Over Flash Limit |
| hot-j | hot-g+callee-loader | 14325/14306 | 11/30 | 100/103 | 108/108 | 408/393 | Fits |
| hot-k | hot-g+callee-dispatch | 14363/14344 | -27/-8 | 100/103 | 108/108 | 408/393 | Over Flash Limit |
| hot-l | hot-g+callee-expired | 14329/14310 | 7/26 | 100/103 | 108/108 | 408/393 | Fits |
| hot-m | hot-g+cold-state | 14329/14310 | 7/26 | 102/105 | 108/108 | 410/395 | Fits |
| hot-n | hot-g+validation-external | 14337/14318 | -1/18 | 100/103 | 108/108 | 409/394 | Over Flash Limit |
| hot-o | hot-g+stable-external | 14369/14350 | -33/-14 | 108/111 | 108/108 | 415/400 | Over Flash Limit |
| hot-p | hot-g+wide-optional | 14309/14288 | 27/48 | 100/103 | 108/108 | 408/393 | Fits |
| hot-q | hot-g+stable-external+wide-optional | 14361/14340 | -25/-4 | 108/111 | 108/108 | 415/400 | Over Flash Limit |
| hot-r | hot-p+cold-state | 14321/14300 | 15/36 | 102/105 | 108/108 | 410/395 | Fits |
| hot-s | hot-p+cold-state+cool-rates | 14355/14334 | -19/2 | 105/108 | 108/108 | 413/398 | Over Flash Limit |
| hot-t | hot-p+cold-state+cool-global | 14329/14308 | 7/28 | 103/106 | 108/108 | 411/396 | Fits |
| hot-u | hot-s+reuse-offset | 14355/14334 | -19/2 | 105/108 | 108/108 | 413/398 | Over Flash Limit |
| nogcse | combined | 14795/14776 | -459/-440 | 104/107 | 102/102 | 420/405 | RAM Fail |
| noinduction | combined | 14539/14520 | -203/-184 | 100/103 | 102/102 | 420/405 | Over Flash Limit |
| order-a | hot-r+legacy-order | 14351/14330 | -15/6 | 101/104 | 108/108 | 410/395 | Over Flash Limit |
| order-b | hot-p+legacy-order | 14339/14318 | -3/18 | 99/102 | 108/108 | 408/393 | Over Flash Limit |
| order-c | hot-d+legacy-order | 14341/14322 | -5/14 | 97/100 | 108/108 | 406/391 | Over Flash Limit |
| order-d | order-b+tap-comparison | 14331/14310 | 5/26 | 99/102 | 108/108 | 408/393 | Fits |
| order-e | order-a+tap-comparison | 14341/14320 | -5/16 | 101/104 | 108/108 | 410/395 | Over Flash Limit |
| order-f | order-b+event-parallel | 14337/14316 | -1/20 | 99/102 | 108/108 | 408/393 | Over Flash Limit |
| order-g | order-b+poll-mask | 14339/14318 | -3/18 | 99/102 | 108/108 | 408/393 | Over Flash Limit |
| order-h | order-e+tap-index | 14339/14318 | -3/18 | 101/104 | 108/108 | 410/395 | Over Flash Limit |
| order-i | order-h+poll-external | 14345/14324 | -9/12 | 102/105 | 108/108 | 411/396 | Over Flash Limit |
| order-j | order-i+cool-global | 14353/14332 | -17/4 | 103/106 | 108/108 | 412/397 | Over Flash Limit |
| order-k | order-h+poll-bit+event-parallel | 14335/14314 | 1/22 | 102/105 | 108/108 | 410/395 | Fits |
| order-l | order-d+poll-bit | 14329/14308 | 7/28 | 100/103 | 108/108 | 408/393 | Fits |
| order-m | order-k+metadata-subtraction | 14329/14310 | 7/26 | 102/105 | 108/108 | 410/395 | Fits |
| raw-pdata | combined | 14501/14482 | -165/-146 | 99/102 | 108/108 | 413/398 | Over Flash Limit |
| selected | order-m + cleanup/tests | 14329/14310 | 7/26 | 102/105 | 108/108 | 410/395 | Fits |
| stack | combined | 14567/14548 | -231/-212 | 105/108 | 102/102 | 424/409 | Over Flash Limit |
| usb-data-clocks | combined | 14501/14482 | -165/-146 | 105/108 | 102/102 | 414/399 | RAM Fail |
| usb-data-queue | combined | 14487/14468 | -151/-132 | 97/100 | 102/102 | 417/402 | Over Flash Limit |
| usb-pdata-clocks | combined | 14509/14490 | -173/-154 | 98/101 | 108/108 | 414/399 | RAM Fail |
| usb-pdata-generation | combined | 14529/14510 | -193/-174 | 100/103 | 103/103 | 419/404 | Over Flash Limit |
| usb-pdata-idle | combined | 14503/14484 | -167/-148 | 98/101 | 106/106 | 416/401 | RAM Fail |
| usb-pdata-queue | combined | 14499/14480 | -163/-144 | 97/100 | 105/105 | 417/402 | RAM Fail |
| usb-pdata-six | combined | 14491/14472 | -155/-136 | 97/100 | 108/108 | 414/399 | RAM Fail |
