/*
 * adc.h
 *
 *  Created on: Aug 11, 2025
 *      Author: ktw15
 */

#ifndef INC_ADC_H_
#define INC_ADC_H_

#include "stm32f1xx_hal.h"
#include <stdio.h>
#include "usb_device.h"
#include "usbd_cdc_if.h"

#define ADC_CHANNELS	8
#define ADC_LEN			1
#define ADC_SAMPLING_PERIOD_US 3

//#define OUTPUT_BUF_LEN 7000
typedef struct {
	TIM_HandleTypeDef *htim;
	uint16_t adcmem[2][ADC_LEN+1][ADC_CHANNELS];
	int adcmem_switch;
	int catched_switch;
} ADC_Option_t;

void ADC_Setup(ADC_HandleTypeDef *hadc, ADC_Option_t* opt);

#endif /* INC_ADC_H_ */
