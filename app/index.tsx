import { MaterialIcons } from '@react-native-vector-icons/material-icons';
import { useRouter } from 'expo-router';
import LottieView from 'lottie-react-native';
import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, Text, View } from "react-native";
import { SafeAreaView } from 'react-native-safe-area-context';
import { styles } from '../styles/index.styles';

export default function Index(){
    const router = useRouter();
    // 1. Create a fade value for each element
  const fade1 = useRef(new Animated.Value(0)).current; // Title
  const fade2 = useRef(new Animated.Value(0)).current; // Title
  const fade3 = useRef(new Animated.Value(0)).current; // "in motion." appearance (no longer fades, snaps in)
  const fade4 = useRef(new Animated.Value(0)).current; // Quote
  const fade5 = useRef(new Animated.Value(0)).current; // Buttons
  const wiggleAnim = useRef(new Animated.Value(0)).current; // Drives the "in motion." wiggle rotation
  const wiggleLoopRef = useRef<Animated.CompositeAnimation | null>(null); // Holds the looping wiggle so we can stop it on unmount

  useEffect(() => {
    // 2. Sequence the animations
    Animated.sequence([
      Animated.timing(fade1, { toValue: 1, duration: 800, useNativeDriver: true }),
      Animated.timing(fade2, { toValue: 1, duration: 800, useNativeDriver: true }),
      // Replaces the old fade3 timing step: "in motion." snaps to visible and wiggles
      // instead of fading in, while keeping the same ~800ms slot in the sequence.
      Animated.parallel([
        Animated.timing(fade3, { toValue: 1, duration: 0, useNativeDriver: true }),
        Animated.sequence([
          Animated.timing(wiggleAnim, { toValue: 1, duration: 160, useNativeDriver: true }),
          Animated.timing(wiggleAnim, { toValue: -1, duration: 160, useNativeDriver: true }),
          Animated.timing(wiggleAnim, { toValue: 1, duration: 160, useNativeDriver: true }),
          Animated.timing(wiggleAnim, { toValue: -1, duration: 160, useNativeDriver: true }),
          Animated.timing(wiggleAnim, { toValue: 0, duration: 160, useNativeDriver: true }),
        ]),
      ]),
      Animated.timing(fade4, { toValue: 1, duration: 750, useNativeDriver: true }),
      Animated.timing(fade5, { toValue: 1, duration: 700, useNativeDriver: true }),
    ]).start(() => {
      // 3. Once the intro sequence finishes, keep "in motion." wiggling every 2s
      wiggleLoopRef.current = Animated.loop(
        Animated.sequence([
          Animated.delay(1200), // wiggle itself takes 800ms, so 1200 + 800 = 2000ms cycle
          Animated.timing(wiggleAnim, { toValue: 1, duration: 160, useNativeDriver: true }),
          Animated.timing(wiggleAnim, { toValue: -1, duration: 160, useNativeDriver: true }),
          Animated.timing(wiggleAnim, { toValue: 1, duration: 160, useNativeDriver: true }),
          Animated.timing(wiggleAnim, { toValue: -1, duration: 160, useNativeDriver: true }),
          Animated.timing(wiggleAnim, { toValue: 0, duration: 160, useNativeDriver: true }),
        ])
      );
      wiggleLoopRef.current.start();
    });

    // 4. Stop the loop if this screen unmounts, so it doesn't keep animating in the background
    return () => {
      wiggleLoopRef.current?.stop();
    };
  }, []);

  return(
  <SafeAreaView style={styles.container}>
    <View style={styles.titleContainer}>
      <Animated.Text style={[styles.brand, { opacity: fade1 }]}>circulaID</Animated.Text>

        <Animated.View style={[styles.lottie, { opacity: fade1 }]}>
      <LottieView
        style={{ flex: 1 }} // Ensures Lottie fills the Animated.View container
        source={require('../assets/lottie/CatAssistant.json')}
       autoPlay
        loop
      />
    </Animated.View>
      <Animated.Text style={[styles.textBold1, { opacity: fade2 }]}>Your identity,</Animated.Text>
      <Animated.Text
        style={[
          styles.textBold2,
          {
            opacity: fade3,
            transform: [
              {
                rotate: wiggleAnim.interpolate({
                  inputRange: [-1, 1],
                  outputRange: ['-8deg', '8deg'],
                }),
              },
            ],
          },
        ]}
      >
        in motion.
      </Animated.Text>
      <Animated.Text style={[styles.textSub, { opacity: fade4 }]}>"Trusted hands just around the corner!"</Animated.Text>
    </View>

    <Animated.View style={[styles.buttonContainer, { opacity: fade5 }]}>
      <Pressable style={styles.buttonSignup} onPress={()=>router.push('/login')}>
        <MaterialIcons name="login" size={24} color="#ffffff" />
        <Text style={styles.textSignup}>Get Started!</Text>
      </Pressable>
    </Animated.View>
  </SafeAreaView>
);
}