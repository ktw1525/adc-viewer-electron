/*
 * adc.c
 *
 *  Created on: Aug 11, 2025
 *      Author: ktw15
 */


#include "adc.h"

static ADC_Option_t *opt;
const uint32_t ADC_DMA_LEN = ADC_LEN*ADC_CHANNELS;
const uint16_t CDC_send_len = ADC_LEN*ADC_CHANNELS*sizeof(uint16_t)*2;
static void next_switch(void){
	opt->adcmem_switch = (opt->adcmem_switch+1)%2;
}

void Update_Timer(int adc_period)
{
  HAL_TIM_Base_Stop(opt->htim);
  HAL_TIM_Base_DeInit(opt->htim);
  opt->htim->Init.Period = adc_period;
  HAL_TIM_Base_Init(opt->htim);
  HAL_TIM_Base_Start(opt->htim);
}

void ADC_Setup(ADC_HandleTypeDef *hadc, ADC_Option_t* _opt){
	opt = _opt;
	opt->adcmem_switch = 0;
	opt->catched_switch = 1;
	Update_Timer(ADC_SAMPLING_PERIOD_US);
	HAL_ADC_Start_DMA(hadc, (uint32_t*)&opt->adcmem[opt->adcmem_switch][0][0], ADC_DMA_LEN);
}

void HAL_ADC_ConvCpltCallback(ADC_HandleTypeDef* hadc)
{
	char resp[128]={0,};
	if(hadc->Instance == ADC1 && opt->catched_switch){
		opt->catched_switch = 0;
		int sw = opt->adcmem_switch;
		next_switch();
		HAL_ADC_Start_DMA(hadc, (uint32_t*)&opt->adcmem[opt->adcmem_switch][0][0], ADC_DMA_LEN);
		CDC_Transmit_FS((uint8_t*)&opt->adcmem[sw][0][0], CDC_send_len);
		opt->catched_switch = 1;

	}
}
